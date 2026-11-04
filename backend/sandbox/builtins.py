"""In-process `mkdir`, `touch`, `cp`, `mv`, `ls` and `pwd` for hosts whose PATH has no such programs (native Windows).

The permission policy lists these six commands (Workspace write, the read-only allowlist). It validates the argv; this module only
runs it when `shutil.which` finds no program of that name. Only the flags the policy lists are implemented; any other flag is
refused with exit code 2 instead of being ignored. Symlinks are never followed when copying a tree.
"""
import os
import shutil
from pathlib import Path

BUILTINS = frozenset({'mkdir', 'touch', 'cp', 'mv', 'ls', 'pwd'})
_FLAGS = {'mkdir': 'pv', 'touch': 'c', 'cp': 'rRnv', 'mv': 'nv', 'ls': 'aA1'}


class _Failure(Exception):
    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = code


def _split(program: str, args: list[str]) -> tuple[set[str], list[str]]:
    flags, operands, options = set(), [], True
    for arg in args:
        if options and arg == '--':
            options = False
        elif options and len(arg) > 1 and arg[0] == '-':
            bad = [c for c in arg[1:] if c not in _FLAGS[program]]
            if bad:
                raise _Failure(f"{program}: option '-{bad[0]}' is not supported here", 2)
            flags.update(arg[1:])
        else:
            operands.append(arg)
    return flags, operands


def _is_link(path) -> bool:
    return os.path.islink(path) or os.path.isjunction(path)


def _guard(program: str, cwd: Path, name: str) -> Path:
    """`cwd / name`, refused when it or any directory on the way to it (below `cwd`) is a link or junction: nothing is
    written, or copied from, through one. A path that leaves `cwd` was approved by the person, so only its last part is checked."""
    target = Path(os.path.normpath(cwd / name))
    inside = target.is_relative_to(cwd)
    for part in (target, *target.parents) if inside else (target,):
        if inside and part == Path(cwd):
            break
        if _is_link(part):
            raise _Failure(f"{program}: refusing to go through the link '{part.name}'")
    return target


def _holds_link(tree: Path) -> bool:
    """True when anything inside `tree` is a symbolic link or a Windows junction (never followed)."""
    for directory, names, files in os.walk(tree, followlinks=False):
        if any(_is_link(os.path.join(directory, name)) for name in (*names, *files)):
            return True
    return False


def _mkdir(cwd: Path, flags: set[str], operands: list[str]) -> list[str]:
    if not operands:
        raise _Failure('mkdir: missing operand', 2)
    out = []
    for name in operands:
        target = _guard('mkdir', cwd, name)
        if target.exists() and 'p' not in flags:
            raise _Failure(f"mkdir: cannot create directory '{name}': File exists")
        try:
            target.mkdir(parents='p' in flags, exist_ok='p' in flags)
        except FileNotFoundError:
            raise _Failure(f"mkdir: cannot create directory '{name}': No such file or directory") from None
        if 'v' in flags:
            out.append(f"mkdir: created directory '{name}'")
    return out


def _touch(cwd: Path, flags: set[str], operands: list[str]) -> list[str]:
    if not operands:
        raise _Failure('touch: missing file operand', 2)
    for name in operands:
        target = _guard('touch', cwd, name)
        if target.exists():
            os.utime(target)
        elif 'c' not in flags:
            try:
                target.touch()
            except FileNotFoundError:
                raise _Failure(f"touch: cannot touch '{name}': No such file or directory") from None
    return []


def _pairs(cwd: Path, program: str, sources: list[str], dest_name: str) -> list[tuple[Path, Path]]:
    """(source, target) pairs: into an existing directory, `dir/<name of each source>`; otherwise the single target itself."""
    dest = _guard(program, cwd, dest_name)
    if dest.is_dir():
        return [(_guard(program, cwd, s), _guard(program, cwd, os.path.join(dest_name, Path(s.rstrip('/\\')).name))) for s in sources]
    if len(sources) > 1:
        raise _Failure(f"{program}: target '{dest_name}' is not a directory")
    return [(_guard(program, cwd, sources[0]), dest)]


def _transfer(program: str):
    def run(cwd: Path, flags: set[str], operands: list[str]) -> list[str]:
        if len(operands) < 2:
            raise _Failure(f'{program}: missing file operand', 2)
        out = []
        for source, target in _pairs(cwd, program, operands[:-1], operands[-1]):
            shown = source.name
            if not os.path.lexists(source):
                raise _Failure(f"{program}: cannot stat '{shown}': No such file or directory")
            if 'n' in flags and os.path.lexists(target):
                continue
            if program == 'cp':
                if source.is_dir():
                    if not flags & {'r', 'R'}:
                        raise _Failure(f"cp: -r not specified; omitting directory '{shown}'")
                    if _holds_link(source):
                        raise _Failure(f"cp: '{shown}' holds a symbolic link or junction, which is not copied here")
                    shutil.copytree(source, target, symlinks=True, dirs_exist_ok=True)
                else:
                    shutil.copy2(source, target)
            else:
                shutil.move(source, target)
            if 'v' in flags:
                out.append(f"'{shown}' -> '{target.name}'")
        return out
    return run


def _ls(cwd: Path, flags: set[str], operands: list[str]) -> list[str]:
    names = []
    for name in operands or ['.']:
        target = cwd / name
        if target.is_dir():
            entries = sorted(os.listdir(target), key=str.lower)
            if 'a' in flags:
                entries = ['.', '..', *entries]
            elif 'A' not in flags:
                entries = [e for e in entries if not e.startswith('.')]
            names.extend(entries)
        elif os.path.lexists(target):
            names.append(name)
        else:
            raise _Failure(f"ls: cannot access '{name}': No such file or directory")
    return names


_HANDLERS = {'mkdir': _mkdir, 'touch': _touch, 'cp': _transfer('cp'), 'mv': _transfer('mv'), 'ls': _ls}


def run_builtin(argv: list[str], cwd: Path) -> tuple[int, str]:
    """(exit code, text) for one of `BUILTINS`; blocking, meant to run in a worker thread."""
    program = argv[0]
    try:
        if program == 'pwd':
            if len(argv) > 1:
                raise _Failure('pwd: options are not supported here', 2)
            return 0, str(Path(cwd))
        flags, operands = _split(program, argv[1:])
        return 0, '\n'.join(_HANDLERS[program](Path(cwd), flags, operands))
    except _Failure as failure:
        return failure.code, str(failure)
    except OSError as error:
        return 1, f'{program}: {error.strerror or error}'
