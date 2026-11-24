"""Outbound network policy. A named host is allowed only when the policy says so; a denial wins.

The check happens before the command runs, so a refused host never starts. It fails closed:

* every URL of any scheme in every argument is judged (with or without a user, port or trailing dot), not only the first;
* an argument that holds spaces is read as a command of its own, so a `sh -c '...; ...'` payload is judged word by word;
* `user@host` and `user@host:path` (ssh, scp, git) are hosts, and so is a bare name or IPv4 address when a program that talks to
  the network appears anywhere in the command;
* a proxy, a resolver override or a jump host (`--proxy`, `-x`, `--resolve`, `--connect-to`, `-J`, `ProxyCommand`...) is refused
  whenever a policy applies, because it changes where the traffic really goes;
* hosts are compared in one canonical spelling: IPv4 in any numeric form (decimal, hex, octal, short) and IPv6 with a mapped IPv4;
* what it cannot read safely is refused, not guessed: a shell payload with `$`, backticks, backslashes or quotes, a host with
  percent-encoding or characters outside ASCII;
* a policy that extends a named policy the definition does not have refuses every host.

A command that names no host is local and is not judged here.
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
SHELLS = frozenset({'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'powershell', 'pwsh'})
# Characters a shell expands or unquotes. The policy does not run a shell to see what they become, so it refuses them instead.
_SHELL_SPECIAL = ('$', '`', '\\', '"', "'")
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
    return text  # a name that is not plain ASCII is refused by `unreadable`, never converted


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


def hosts_in(argv: list[str]) -> list[str]:
    words = _words(argv)
    network_program = any(_program(word) in NETWORK_PROGRAMS for word in words)
    found: list[str] = []
    for part in argv:
        for match in _URL.finditer(str(part)):
            host = canonical(_authority_host(match.group(1)))
            if host:
                found.append(host)
    for word in words:
        if '://' in word or word.startswith('-'):
            continue
        if at := _USER_AT.match(word):
            host = re.split(r'[:/]', word[at.end():], maxsplit=1)[0]
            if host:
                found.append(canonical(host))
        elif network_program:
            candidate = re.split(r'[:/]', word, maxsplit=1)[0]
            if _is_hostname(candidate.lower().rstrip('.')) or _ipv4(candidate.lower()) is not None or not candidate.isascii():
                found.append(canonical(candidate))
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
    """Why the command cannot be judged safely, or None. Refused instead of guessed: a shell payload that expands or unquotes,
    a URL host with percent-encoding or characters outside ASCII."""
    if argv and _program(str(argv[0])) in SHELLS and any(mark in str(part) for part in argv[1:] for mark in _SHELL_SPECIAL):
        return 'The network policy cannot judge a shell command that expands or quotes words; run the command directly.'
    for part in argv[1:] if argv else []:
        text = str(part)
        for match in _URL.finditer(text):
            host = _authority_host(match.group(1))
            if '%' in host or not host.isascii():
                return 'The network policy cannot judge a host written with percent-encoding or non-ASCII characters.'
        if ('://' in text or '@' in text) and any(mark in text for mark in ('$', '`')):
            return 'The network policy cannot judge a host built by the shell.'
        if any(not word.isascii() for word in _WORD.findall(text)) and _program(str(argv[0])) in NETWORK_PROGRAMS:
            return 'The network policy cannot judge a host written with non-ASCII characters.'
    return None


def verdict(policy: dict, host: str) -> str | None:
    host = canonical(host)
    if policy.get('missing'):
        return f'The network policy extends {policy["missing"][0]}, which this definition does not have, so no host is allowed.'
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
