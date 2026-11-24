"""Outbound network policy. A named host is allowed only when the policy says so; a denial wins.

The check happens before the command runs, so a refused host never starts. It fails closed:

* every URL of any scheme in every argument is judged (with or without a user, port or trailing dot), not only the first;
* an argument that holds spaces is read as a command of its own, so a `sh -c '...; ...'` payload is judged word by word;
* `user@host` and `user@host:path` (ssh, scp, git) are hosts, and so is a bare name or IPv4 address when a program that talks to
  the network appears anywhere in the command;
* a proxy, a resolver override or a jump host (`--proxy`, `-x`, `--resolve`, `--connect-to`, `-J`, `ProxyCommand`...) is refused
  whenever a policy applies, because it changes where the traffic really goes;
* hosts are compared in one canonical spelling: IPv4 in any numeric form (decimal, hex, octal, short) and IPv6 with a mapped IPv4;
* what it cannot read safely is refused, not guessed: any PowerShell command; with a shell, a wrapper or a network program in the
  command, an argument with a character a shell expands, unquotes or globs; with any program, a URL or `user@` argument built
  with `$` or backticks; a URL host that is not a plain name, IPv4 or IPv6 literal; a host with percent-encoding or outside ASCII;
* a policy that extends a named policy the definition does not have, or holds an entry outside ASCII, refuses every host.

A command that names no host is local and is not judged here. This is a check on the command line, not an egress firewall: a
program that builds its host at run time (a script reading a URL from a file) is beyond it, and needs an OS or sandbox block.
"""
from __future__ import annotations

import ipaddress
import re

_LABEL = re.compile(r'[a-z0-9-]{1,63}')
_NUMERIC = re.compile(r'(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}')
_USER_AT = re.compile(r'[A-Za-z0-9._~+-]{1,64}@')
# The authority runs to the first `/?#` (or a space), as curl reads it: a quote does not end it, and the host is after the last `@`.
_URL = re.compile(r'[A-Za-z][A-Za-z0-9+.-]{0,15}://([^\s/?#]*)')
_WORD = re.compile(r'''[^\s;&|()`'"<>]+''')
_PATH_SEP = re.compile(r'[\\/]')
# Programs whose bare arguments may be hosts. Without one of them only a URL or a user@host form counts.
NETWORK_PROGRAMS = frozenset({'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'ping', 'http',
                              'https', 'git', 'nslookup', 'dig', 'host', 'socat'})
# Options that send the traffic somewhere other than the host the command names.
_REDIRECT_OPTIONS = frozenset({'--proxy', '-x', '--preproxy', '--socks4', '--socks4a', '--socks5', '--socks5-hostname', '--proxy1.0',
                               '--resolve', '--connect-to', '--doh-url', '-j', '--dns-servers', '-e'})
SHELLS = frozenset({'sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'csh', 'tcsh', 'fish', 'busybox', 'cmd', 'powershell', 'pwsh'})
# Programs that run another program: what follows them is judged as if it were the command.
WRAPPERS = frozenset({'env', 'timeout', 'nice', 'nohup', 'xargs', 'sudo', 'doas', 'stdbuf', 'time', 'exec', 'command', 'start'})
# Characters a shell expands or unquotes (POSIX shells and cmd). The policy does not run a shell to see what they become, so it
# refuses them instead.
_SHELL_SPECIAL = ('$', '`', '\\', '"', "'", '^', '%', '!', '{', '}', '[', ']', '*', '?', '~')
_REDIRECT_WORDS = ('proxycommand', 'proxyjump', 'proxy=', 'http_proxy', 'https_proxy', 'all_proxy')


def policy_for(definition: dict, agent_id: str) -> dict:
    agents = definition.get('agents') or {}
    agent = agents.get(agent_id) or {}
    base = definition.get('networkPolicy') or {}
    own = agent.get('networkPolicy') or {}
    named = definition.get('networkPolicies') or {}
    allowed: list[str] = []
    denied: list[str] = []
    missing: list[str] = []
    for source in (base, own):
        for ref in source.get('extends') or []:
            extra = named.get(ref)
            if not isinstance(extra, dict):
                missing.append(str(ref))
                continue
            allowed.extend(extra.get('allowedHosts') or [])
            denied.extend(extra.get('deniedHosts') or [])
        allowed.extend(source.get('allowedHosts') or [])
        denied.extend(source.get('deniedHosts') or [])
    # An entry the policy cannot read in one spelling (outside ASCII, percent-encoded) closes it: authors write the A-label.
    missing += [f'the entry {h!r}' for h in [*allowed, *denied] if not _plain(str(h))]
    return {'allowedHosts': [canonical(h) for h in allowed], 'deniedHosts': [canonical(h) for h in denied], 'missing': missing}


def _ipv4(text: str) -> str | None:
    """The IPv4 address a numeric host means, read the way `inet_aton` reads it: 1 to 4 parts, each decimal, 0x hex or 0 octal."""
    if not _NUMERIC.fullmatch(text):
        return None
    values = []
    for part in text.split('.'):
        try:
            values.append(int(part, 16) if part.startswith('0x') else int(part, 8) if len(part) > 1 and part.startswith('0') else int(part))
        except ValueError:
            return None
    *head, last = values
    if any(value > 255 for value in head) or last >= 256 ** (4 - len(head)):
        return None
    number = 0
    for value in head:
        number = number * 256 + value
    number = number * 256 ** (4 - len(head)) + last
    return str(ipaddress.IPv4Address(number))


def canonical(host: str) -> str:
    """One spelling per host: lower case, no trailing dot or brackets, IPv4 in dotted decimal, a mapped IPv6 as IPv4, names in IDNA."""
    text = str(host).strip().lower().rstrip('.')
    if text.startswith('[') and text.endswith(']'):
        text = text[1:-1]
    if (ip := _ipv4(text)) is not None:
        return ip
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        address = None
    if isinstance(address, ipaddress.IPv6Address):
        return str(address.ipv4_mapped) if address.ipv4_mapped else address.compressed
    if address is not None:
        return str(address)
    return text  # never converted: a policy entry outside ASCII closes the policy, a command host outside ASCII is refused


def _is_hostname(text: str) -> bool:
    """Two or more dot-separated labels, the last one starting with a letter. Checked label by label, in linear time."""
    labels = text.split('.')
    if len(text) > 253 or len(labels) < 2:
        return False
    if not all(_LABEL.fullmatch(label) and not label.startswith('-') and not label.endswith('-') for label in labels):
        return False
    return labels[-1][0].isalpha()


def _authority_host(authority: str) -> str:
    """`user:pass@host:port` → `host`; `[::1]:80` → `::1`."""
    host = authority.rsplit('@', 1)[-1]
    if host.startswith('['):
        return host[1:].split(']', 1)[0]
    return host.split(':', 1)[0]


def _words(argv: list[str]) -> list[str]:
    """Every word of the command, the words inside an argument that holds a command (`sh -c '...'`) included."""
    words: list[str] = []
    for part in argv:
        words.extend(_WORD.findall(str(part)))
    return words


def _program(word: str) -> str:
    return _PATH_SEP.split(word)[-1].lower().removesuffix('.exe')


def hosts_in(argv: list[str], *, raw: bool = False) -> list[str]:
    """The hosts the command names, canonical. `raw` keeps them as written, for the readability check."""
    words = _words(argv)
    network_program = any(_program(word) in NETWORK_PROGRAMS for word in words)
    spell = (lambda host: host) if raw else canonical
    found: list[str] = []
    for part in argv:
        for match in _URL.finditer(str(part)):
            host = _authority_host(match.group(1))
            if host:
                found.append(spell(host))
    for word in words:
        if '://' in word or word.startswith('-'):
            continue
        if at := _USER_AT.match(word):
            host = re.split(r'[:/]', word[at.end():], maxsplit=1)[0]
            if host:
                found.append(spell(host))
        elif network_program:
            candidate = re.split(r'[:/]', word, maxsplit=1)[0]
            if _is_hostname(candidate.lower().rstrip('.')) or _ipv4(candidate.lower()) is not None or not candidate.isascii():
                found.append(spell(candidate))
    return found


def redirects(argv: list[str]) -> bool:
    """A proxy, a resolver override or a jump host in a command that talks to the network (`sed -e` and `make -j` are not)."""
    words = _words(argv)
    if not any(_program(word) in NETWORK_PROGRAMS for word in words):
        return any(marker in word.lower() for word in words for marker in _REDIRECT_WORDS)
    for word in words:
        lowered = word.lower()
        if lowered.split('=', 1)[0] in _REDIRECT_OPTIONS or any(marker in lowered for marker in _REDIRECT_WORDS):
            return True
        if lowered.startswith('-o') and 'proxy' in lowered:
            return True
    return False


def unreadable(argv: list[str]) -> str | None:
    """Why the command cannot be judged safely, or None. Refused instead of guessed.

    When a shell, a wrapper or a network program appears anywhere in the command, no argument may hold a character any shell
    expands or unquotes (PowerShell adds its own). Whatever the program, a host with percent-encoding or outside ASCII is refused.
    """
    if not argv:
        return None
    programs = {_program(str(argv[0]))} | {_program(word) for word in _words(argv)}
    if programs & {'powershell', 'pwsh'}:
        return 'The network policy cannot judge a PowerShell command; run the program directly.'
    if programs & (SHELLS | WRAPPERS | NETWORK_PROGRAMS):
        if any(mark in _without_ipv6(str(part)) for part in argv[1:] for mark in _SHELL_SPECIAL):
            return 'The network policy cannot judge a command whose words a shell would expand or unquote; run it directly, without those characters.'
    for part in argv[1:]:
        text = str(part)
        if ('://' in text or '@' in text) and any(mark in text for mark in ('$', '`')):  # whatever the program: a host built by a shell
            return 'The network policy cannot judge a host built by the shell.'
        for match in _URL.finditer(text):
            if not _strict_host(_authority_host(match.group(1))):
                return 'The network policy cannot judge this host: it is not a plain name, IPv4 or IPv6 address.'
    if any(not _plain(host) for host in hosts_in(argv, raw=True)):
        return 'The network policy cannot judge a host written with percent-encoding or non-ASCII characters.'
    return None


_BRACKETED = re.compile(r'\[([0-9A-Fa-f:.]{2,45})\]')


def _without_ipv6(text: str) -> str:
    """The text with each bracketed IPv6 literal taken out: those brackets are the address, not a shell glob."""
    def keep(match):
        try:
            ipaddress.IPv6Address(match.group(1))
        except ValueError:
            return match.group(0)
        return ''
    return _BRACKETED.sub(keep, text)


def _plain(host: str) -> bool:
    return host.isascii() and '%' not in host


def _strict_host(host: str) -> bool:
    """A URL host the policy can read: a host name, an IPv4 address in any numeric form, or an IPv6 literal. Nothing else."""
    text = host.lower().rstrip('.')
    if not text or not _plain(text):
        return False
    if _is_hostname(text) or _ipv4(text) is not None:
        return True
    try:
        ipaddress.IPv6Address(text)
    except ValueError:
        return False
    return True


def verdict(policy: dict, host: str) -> str | None:
    host = canonical(host)
    if policy.get('missing'):
        return f'The network policy cannot be read ({policy["missing"][0]} is missing or not plain ASCII), so no host is allowed.'
    if host in policy['deniedHosts']:
        return f'The network policy denies {host}.'
    allowed = policy['allowedHosts']
    if allowed and host not in allowed:
        return f'The network policy does not allow {host}.'
    return None


def command_denied(definition: dict, agent_id: str, argv: list[str]) -> str | None:
    policy = policy_for(definition, agent_id)
    if not policy['allowedHosts'] and not policy['deniedHosts'] and not policy['missing']:
        return None
    if reason := unreadable(argv):
        return reason
    if redirects(argv):
        return 'The network policy does not allow a proxy, a resolver override or a jump host.'
    for host in hosts_in(argv):
        reason = verdict(policy, host)
        if reason:
            return reason
    return None
