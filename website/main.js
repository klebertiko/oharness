import { t } from './i18n.js';

const menu = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
const desktopLayout = matchMedia('(min-width: 761px)');
desktopLayout.addEventListener('change', event => { if (event.matches)
    closeMenu(); });
function closeMenu() { if (!menu)
    return; menu.setAttribute('aria-expanded', 'false'); mobileNav.hidden = true; }
menu?.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); mobileNav.hidden = !open; });
mobileNav?.addEventListener('click', (event) => { if (event.target.closest('a'))
    closeMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
} });
const descriptions = {
    agent: t('agent'),
    skill: t('skill'),
    gate: t('gate'),
    human: t('human')
};
document.querySelectorAll('[data-piece]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-piece]').forEach((node) => node.setAttribute('aria-pressed', String(node === button)));
    document.querySelector('#piece-description').textContent = descriptions[button.dataset.piece];
}));
const tabs = [...document.querySelectorAll('[data-tour]')];
function selectTab(tab) {
    tabs.forEach((item) => { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; document.getElementById(item.getAttribute('aria-controls')).hidden = !selected; });
}
tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
        const keys = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
        if (!(event.key in keys))
            return;
        event.preventDefault();
        const target = tabs[keys[event.key]];
        selectTab(target);
        target.focus();
    });
});
const dialog = document.querySelector('#screenshot-dialog');
document.querySelectorAll('[data-zoom]').forEach((button) => button.addEventListener('click', () => {
    const source = button.querySelector('img');
    const target = document.querySelector('#screenshot-full');
    target.src = source.src;
    target.alt = source.alt;
    document.querySelector('#screenshot-title').textContent = { chats: 'Chats', studio: 'Harness Studio', canvas: 'Canvas', run: t('zoomRun'), providers: 'Providers' }[button.dataset.zoom];
    dialog.showModal();
}));
document.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        dialog.close();
} });
document.querySelector('[data-copy]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
        await navigator.clipboard.writeText(document.querySelector('#model-example').textContent);
        button.textContent = t('copied');
    }
    catch {
        button.textContent = t('copyFallback');
    }
});
// Connectors follow actual node geometry as fonts and viewport sizes change.
const mapStage = document.querySelector('.map-stage');
if (mapStage) {
    const lines = mapStage.querySelector('.map-lines');
    const connect = () => {
        const frame = mapStage.getBoundingClientRect();
        const point = (selector, side) => {
            const node = mapStage.querySelector(selector);
            const x = node.offsetLeft;
            const y = node.offsetTop;
            return side === 'right' ? [x + node.offsetWidth, y + node.offsetHeight / 2]
                : side === 'bottom' ? [x + node.offsetWidth / 2, y + node.offsetHeight]
                    : [x, y + node.offsetHeight / 2];
        };
        const paths = [
            [point('.skill-node', 'right'), point('.agent-node', 'left')],
            [point('.agent-node', 'bottom'), point('.gate-node', 'right')],
            [point('.gate-node', 'right'), point('.human-node', 'left')]
        ];
        lines.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
        lines.replaceChildren(...paths.map(([a, b]) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const mid = (a[0] + b[0]) / 2;
            path.setAttribute('pathLength', '1');
            path.setAttribute('d', `M${a[0]} ${a[1]}C${mid} ${a[1]},${mid} ${b[1]},${b[0]} ${b[1]}`);
            return path;
        }));
    };
    new ResizeObserver(connect).observe(mapStage);
    document.fonts.ready.then(connect);
}
