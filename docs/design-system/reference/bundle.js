/* @ds-bundle: {"format":4,"namespace":"OH","components":[{"name":"Button"},{"name":"Input"},{"name":"Badge"},{"name":"Panel"},{"name":"ListRow"},{"name":"Kbd"},{"name":"Nilo"},{"name":"Notice"},{"name":"EmptyState"},{"name":"Segmented"},{"name":"StatusMark"},{"name":"ConfirmInline"},{"name":"Skeleton"},{"name":"Popover"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }

  function Button(props) {
    var variant = props.variant || "secondary", size = props.size || "md";
    var busy = !!props.loading, disabled = !!props.disabled;
    var rest = Object.assign({}, props);
    ["variant", "size", "loading", "icon", "iconOnly", "children", "className"].forEach(function (k) { delete rest[k]; });
    return h("button", Object.assign({
      type: "button",
      className: cx("oh-btn", "oh-btn--" + variant, size !== "md" && "oh-btn--" + size, props.iconOnly && "oh-btn--icon", props.className),
      disabled: disabled,
      "aria-busy": busy ? "true" : undefined
    }, rest, busy ? { onClick: function (e) { e.preventDefault(); } } : null),
      h("span", { className: "oh-btn__label" }, props.icon, props.children),
      busy ? h("span", { className: "oh-btn__spinner", role: "status", "aria-label": "Working" }) : null);
  }

  function Input(props) {
    var id = props.id || React.useId();
    var msgId = id + "-msg";
    var rest = Object.assign({}, props);
    ["label", "hint", "error", "mono", "id", "className"].forEach(function (k) { delete rest[k]; });
    var message = props.error || props.hint || "";
    return h("div", { className: cx("oh-input", props.className) },
      props.label ? h("label", { className: "oh-input__label", htmlFor: id }, props.label) : null,
      h("input", Object.assign({
        id: id,
        className: cx("oh-input__field", props.mono && "oh-input__field--mono"),
        "aria-invalid": props.error ? "true" : undefined,
        "aria-describedby": msgId
      }, rest)),
      h("div", { id: msgId, className: cx("oh-input__msg", props.error && "oh-input__msg--error"), role: props.error ? "alert" : undefined }, message));
  }

  function Badge(props) {
    var tone = props.tone || "neutral";
    var style = props.role ? { "--role": "var(--role-" + props.role + ")" } : undefined;
    return h("span", { className: cx("oh-badge", tone !== "neutral" && "oh-badge--" + tone, props.role && "oh-badge--role", props.className), style: style },
      h("span", { className: "oh-badge__dot", "aria-hidden": "true" }),
      props.children);
  }

  function Panel(props) {
    var variant = props.variant || "panel";
    return h("section", { className: cx("oh-panel", variant !== "panel" && "oh-panel--" + variant, props.className), "aria-labelledby": props.title ? props.titleId : undefined },
      props.title ? h("header", { className: "oh-panel__head" },
        h("h3", { className: "oh-panel__title", id: props.titleId }, props.title),
        props.actions ? h("div", { style: { display: "flex", gap: "var(--space-1)" } }, props.actions) : null) : null,
      h("div", { className: "oh-panel__body" }, props.children));
  }

  function ListRow(props) {
    return h("button", {
      type: "button", className: cx("oh-row", props.className), disabled: props.disabled, onClick: props.onClick,
      "aria-current": props.selected ? "true" : undefined
    },
      props.leading ? h("span", { className: "oh-row__lead" }, props.leading) : null,
      h("span", { className: "oh-row__main" },
        h("span", { className: "oh-row__title" }, props.title),
        props.meta ? h("span", { className: "oh-row__meta" }, props.meta) : null),
      props.trailing ? h("span", { className: "oh-row__trail" }, props.trailing) : null);
  }

  function Kbd(props) { return h("kbd", { className: cx("oh-kbd", props.className) }, props.children); }

  /* ── Nilo: faithful port of frontend/src/components/brand (niloGrid, niloFrames, NiloSprite) ── */
/* Nilo's pixel sprite: the single source of truth for the mascot, the
   title-bar mark and the generated app icons (scripts/brand-icons.mjs parses
   this array, so keep one quoted row per line). Flat blocks, no outline, no
   shading. Her own identity — a scholar owl, not a mascot blob:
     R  round spectacle frames + a focus brow row → intelligence
     K  amber beak, sharp upright ear tufts        → charisma
     R  a tidy chest chevron, square posture       → organization
   The lenses hold a 3-wide white with a 1px pupil that can look in any
   direction — expression comes from the brow, lids and tufts, framed by the
   glasses so it never reads as a wide-eyed mascot.
   B body · W eye-white · P pupil · K beak · R rim/accent. */
const NILO_GRID = [
  ".B.B........B.B.",
  ".BBB........BBB.",
  ".BBBBBBBBBBBBBB.",
  ".RRRRRBBBBRRRRR.",
  ".RRRRRBBBBRRRRR.",
  ".RWWWRBBBBRWWWR.",
  ".RWPWRBKKBRWPWR.",
  ".RWWWRBKKBRWWWR.",
  ".RRRRRBBBBRRRRR.",
  "BBBBBRRRRBBBBBBB",
  ".BBBBRRRRBBBBBB.",
  "..BBBBRRBBBBBB..",
  "....BB....BB....",
];

/** Head only (tufts, brow, spectacles, beak): the crop used where space is tight. */

/** Fill per cell letter, as CSS tokens. Nilo carries her own colour — teal
    body, off-white eyes, a lighter-teal rim for the glasses and chest chevron,
    amber beak. Only the body follows the theme (`--nilo-body` is `--signal`).
    L/M/G/Z are animation-only props (laptop screen, desk, code, sleep glyph). */
const FILL                         = {
  B: "var(--nilo-body)",
  W: "var(--nilo-eye)",
  P: "var(--nilo-pupil)",
  K: "var(--nilo-beak)",
  R: "var(--nilo-rim)",
  L: "var(--nilo-screen)",
  M: "var(--nilo-desk)",
  G: "var(--nilo-code)",
  Z: "var(--nilo-eye)",
};

/** One SVG path per colour, as [fill, d] pairs. */
function cellPaths(rows                                         )                     {
  const paths                           = {};
  rows.forEach((row, y) =>
    Array.from(row).forEach((c, x) => {
      if (c !== ".") (paths[FILL[c] ?? "currentColor"] ??= []).push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return Object.entries(paths).map(([fill, d]) => [fill, d.join("")]);
}



                                                             
                                                                            
                                         
                                                    

/** Everything one animation frame can vary. Omitted fields mean "at rest".
    Studio-style acting: the brow, lids, head tilt and tufts carry emotion, not
    a big darting eyeball. `squash` (−1 tall … +1 tall) gives hops weight. */
                    
              
                      
              
              
              
                                                                      
                    
               
               
                           
                 
                
                
             
                     
                 
  

/** Canvas around the owl, with room above for hops, dots and Zs, and a column
    each side for a wing to lift out of the silhouette. */
const NILO_CANVAS = { w: 18, h: 17 }         ;
const OX = 1;
const OY = 3;
const W = 16;
const HEAD_ROWS = 9; // grid rows 0..8 tilt/lag with the head

                                            
/** Lens interiors, grid coordinates. 3 wide × 3 tall — room for a real gaze. */
const LENS_L = { cx: 3, cy: 6, x0: 2, x1: 4, y0: 5, y1: 7 };
const LENS_R = { cx: 12, cy: 6, x0: 11, x1: 13, y0: 5, y1: 7 };
const BROW_ROW = 4;
const CODE_LINES                  = [[0, 5], [2, 6], [2, 3], [0, 7], [2, 5], [4, 4]];

// Sleep trail: a legible Z closest to the head, shrinking to a single dot as
// it drifts up and away — "Z z z", not one glyph teleporting in place. A
// single middle row can't show a real diagonal at any offset — centred reads
// as a serif "I", offset either way reads as "C" — so the big Z spans two
// diagonal-stepping rows; the smaller marks trail beside it, not above it,
// since headroom above the head is only 4-5 rows deep.
const Z_TRAIL                                                                 = [
  { dx: 9, dy: -4, rows: ["ZZZZ", "..Z.", ".Z..", "ZZZZ"] },
  { dx: 13, dy: -3, rows: ["ZZ", ".Z"] },
  { dx: 15, dy: -2, rows: ["Z"] },
];

const clamp = (v        , lo        , hi        ) => Math.max(lo, Math.min(hi, v));

/** Builds one frame as a grid of cell letters ("." is empty). */
function niloFrame(p       = {})             {
  const g = Array.from({ length: NILO_CANVAS.h }, () => Array        (NILO_CANVAS.w).fill("."));
  const put = (x        , y        , c        ) => {
    if (y >= 0 && y < NILO_CANVAS.h && x >= 0 && x < NILO_CANVAS.w) g[y][x] = c;
  };
  const oy = OY + (p.dy ?? 0);
  const tilt = p.tilt ?? 0;
  const squash = p.squash ?? 0;

  // Body. The head (rows 0..8) leans by `tilt`; a positive `squash` stretches
  // it up a row, a negative one presses it down — weight for the hop.
  NILO_GRID.forEach((row, y) => {
    const isHead = y < HEAD_ROWS;
    const shift = isHead ? tilt : 0;
    const sy = squash > 0 && isHead ? -1 : squash < 0 && y >= HEAD_ROWS ? 0 : 0;
    Array.from(row).forEach((c, x) => {
      if (c === "." || c === "P" || (y === 9 && (x === 0 || x === W - 1))) return;
      put(OX + x + shift, oy + y + sy, c);
    });
  });
  if (squash < 0) {
    // press: pull the crown down one row so the silhouette looks compressed
    for (let x = 1; x <= 14; x++) if (g[oy]?.[OX + x] === "B") { g[oy][OX + x] = "."; }
  }

  // ── Ear tufts — lag the head lean by half for secondary motion ────────────
  const tuftShift = tilt === 0 ? 0 : tilt > 0 ? 1 : -1; // trails, but never zero-jumps
  const tuftCols = [1, 3, 12, 14].map((x) => x + Math.round(tuftShift / 2));
  if (p.tufts === "perk") for (const x of tuftCols) put(OX + x, oy - 1, "B");
  else if (p.tufts === "droop") {
    for (const x of [1, 3, 12, 14]) put(OX + x + tilt, oy, ".");
    put(OX + tilt, oy + 1, "B");
    put(OX + W - 1 + tilt, oy + 1, "B");
  }

  // ── Wings — folded at rest, lifting clear of the body when raised ─────────
  const wing = (side           , state      ) => {
    const col = side === "L" ? 0 : NILO_CANVAS.w - 1;
    const rows = state === "up" ? [5, 6] : state === "mid" ? [7, 8] : [];
    for (const r of rows) put(col, oy + r, "B");
    put(side === "L" ? OX : OX + W - 1, oy + 9, "B"); // keep the shoulder corner
  };
  wing("L", p.wingL ?? "down");
  wing("R", p.wingR ?? "down");

  // ── Brow acting on the dedicated rim row ─────────────────────────────────
  brow(put, oy, tilt, p.brow ?? "rest", p.eyes ?? "open");

  // ── Eyes behind the spectacles ──────────────────────────────────────────
  const kind = p.eyes ?? "open";
  drawEye(put, oy, tilt, LENS_L, "L", kind === "wink" ? "happy" : kind, p.look ?? [0, 0]);
  drawEye(put, oy, tilt, LENS_R, "R", kind === "wink" ? "closed" : kind, p.look ?? [0, 0]);
  if (kind === "none") {
    for (let y = 3; y <= 8; y++)
      for (let x = 1; x <= 14; x++) {
        const cy = oy + y;
        const cx = OX + x + tilt;
        if (g[cy]?.[cx] && g[cy][cx] !== ".") g[cy][cx] = "B";
      }
  }

  // ── Beak ────────────────────────────────────────────────────────────────
  if (p.beakOpen) {
    put(OX + 7 + tilt, oy + 8, "K");
    put(OX + 8 + tilt, oy + 8, "K");
  }

  // ── Laptop — a grey device bezel, not a colour patch. The owl's body and
  //    the screen fill are both light, cool tones — without a hard frame the
  //    "screen" reads as a smudge on the chest, not an object. The bezel
  //    frames a glowing interior; the deck and front lip flare wider below
  //    it in two steps, the wedge silhouette that reads as "laptop" even in
  //    silhouette alone. ─────────────────────────────────────────────────
  if (p.laptop !== undefined) {
    const sx = OX + 2;
    const sy = oy + 8;
    const tick = Math.max(0, Math.floor(p.tick ?? 0));

    for (let x = 1; x <= 10; x++) {
      put(sx + x, sy, "M");
      put(sx + x, sy + 3, "M");
    }
    put(sx + 1, sy + 1, "M");
    put(sx + 10, sy + 1, "M");
    put(sx + 1, sy + 2, "M");
    put(sx + 10, sy + 2, "M");
    for (let y = 1; y <= 2; y++) for (let x = 2; x <= 9; x++) put(sx + x, sy + y, "L");

    for (let i = 0; i < 2; i++) {
      const [indent, len] = CODE_LINES[(i + tick) % CODE_LINES.length];
      const cap = Math.max(0, Math.min(len, 6 - indent));
      for (let x = 0; x < cap; x++) put(sx + 3 + indent + x, sy + 1 + i, "G");
      if (i === 1 && p.laptop) put(sx + 3 + indent + cap, sy + 2, "W");
    }

    for (let x = -1; x <= 12; x++) put(sx + x, sy + 4, "M");
    for (let x = -2; x <= 13; x++) put(sx + x, sy + 5, "M");
  }

  // ── Thought dots · sleep Zs ─────────────────────────────────────────────
  for (let i = 0; i < (p.dots ?? 0); i++) put(OX + 12 + i * 2, oy - 2, "W");
  if (p.z !== undefined) {
    const count = clamp(Math.floor(p.z) + 1, 1, Z_TRAIL.length);
    for (let i = 0; i < count; i++) {
      const g = Z_TRAIL[i];
      g.rows.forEach((row, y) =>
        Array.from(row).forEach((c, x) => c !== "." && put(OX + g.dx + x, oy + g.dy + y, "Z")),
      );
    }
  }

  if (p.flip) g.forEach((r) => r.reverse());
  return g;
}

/** Where the pupil sits for a gaze, inside the 3×3 lens. */
function gazeCell(lens               , [dx, dy]      )       {
  return [clamp(lens.cx + dx, lens.x0, lens.x1), clamp(lens.cy + dy, lens.y0, lens.y1)];
}

function drawEye(
  put                                           ,
  oy        ,
  tilt        ,
  lens               ,
  side           ,
  kind      ,
  look      ,
) {
  const set = (x        , y        , c        ) => put(OX + x + tilt, oy + y, c);
  if (kind === "none") return;
  if (kind === "open") {
    for (let y = lens.y0; y <= lens.y1; y++) for (let x = lens.x0; x <= lens.x1; x++) set(x, y, "W");
    const [px, py] = gazeCell(lens, look);
    set(px, py, "P");
    return;
  }
  // Lids: the interior goes body-coloured, a dark mark draws the closed shape.
  for (let y = lens.y0; y <= lens.y1; y++) for (let x = lens.x0; x <= lens.x1; x++) set(x, y, "B");
  const inner = side === "L" ? lens.x1 : lens.x0;
  const outer = side === "L" ? lens.x0 : lens.x1;
  if (kind === "closed") {
    for (let x = lens.x0; x <= lens.x1; x++) set(x, lens.cy, "P"); // flat lash line
  } else if (kind === "happy") {
    set(outer, lens.cy, "P");
    set(lens.cx, lens.y0, "P");
    set(inner, lens.cy, "P"); // ^_^
  } else if (kind === "squint") {
    // > for the left eye, < for the right
    set(outer, lens.y0, "P");
    set(lens.cx, lens.cy, "P");
    set(outer, lens.y1, "P");
  }
}

function brow(
  put                                           ,
  oy        ,
  tilt        ,
  b      ,
  eyes      ,
) {
  const set = (x        , y        , c        ) => put(OX + x + tilt, oy + y, c);
  const clearInner = () => {
    for (const x of [2, 3, 12, 13]) set(x, BROW_ROW, "B");
  };
  if (b === "up") {
    clearInner();
    set(3, BROW_ROW - 2, "R");
    set(12, BROW_ROW - 2, "R");
  } else if (b === "down") {
    for (const x of [1, 5, 10, 14]) set(x, BROW_ROW + 1, "R"); // frame juts toward the eye
    for (const x of [2, 3, 12, 13]) set(x, BROW_ROW - 1, "B");
  } else if (b === "worry") {
    // inner ends lift, outer ends drop — a soft, concerned tilt
    set(4, BROW_ROW - 1, "R");
    set(11, BROW_ROW - 1, "R");
    set(1, BROW_ROW + 1, "R");
    set(14, BROW_ROW + 1, "R");
  }
  void eyes;
}

const FRAME_MS = 110;
const SLEEP_AFTER_MS = 90_000;
const GLANCES                  = [[-1, 0], [1, 0], [0, -1], [0, 0], [0, 0]];

/* Click reactions — a scripted pose per frame, with anticipation and a settle.
   Five quick clicks make Nilo dizzy. */
const REACTIONS                         = {
  hop: [
    { dy: 1, squash: -1, eyes: "happy", brow: "up" }, // crouch
    { dy: -3, squash: 1, eyes: "happy", wingL: "up", wingR: "up" }, // launch
    { dy: -5, squash: 1, eyes: "happy", wingL: "up", wingR: "up" },
    { dy: -5, eyes: "happy", wingL: "mid", wingR: "mid" }, // apex
    { dy: -2, eyes: "happy", wingL: "mid", wingR: "mid" },
    { dy: 1, squash: -1, eyes: "happy", wingL: "down", wingR: "down" }, // land
    { eyes: "happy", brow: "up" },
    { eyes: "happy" },
  ],
  wink: [
    { eyes: "wink", wingR: "mid", brow: "up" },
    { eyes: "wink", wingR: "up", brow: "up" },
    { eyes: "wink", wingR: "up" },
    { eyes: "wink", wingR: "mid" },
    { eyes: "wink" },
  ],
  headturn: [
    { look: [1, 0], tilt: 1 },
    { look: [1, 0], tilt: 1 },
    { eyes: "none", tilt: 1 },
    { eyes: "none" },
    { eyes: "none", tilt: -1 },
    { look: [-1, 0], tilt: -1 },
    { look: [-1, 0], tilt: -1 },
    { look: [0, 0] },
  ],
  ruffle: [
    { tufts: "perk", wingL: "mid", wingR: "mid", brow: "up" },
    { tufts: "perk", wingL: "up", wingR: "up" },
    { wingL: "mid", wingR: "mid" },
    { tufts: "perk", wingL: "up", wingR: "up" },
    { brow: "up" },
    {},
  ],
  hoot: [
    { beakOpen: true, tufts: "perk", brow: "up", dy: -1 },
    { beakOpen: true, tufts: "perk", brow: "up", dy: -1 },
    { beakOpen: true, tufts: "perk" },
    {},
  ],
  dizzy: [
    { eyes: "squint", tilt: 1, brow: "worry" },
    { eyes: "squint", tilt: -1, flip: true },
    { eyes: "squint", tilt: 1 },
    { eyes: "squint", tilt: -1, flip: true },
    { eyes: "squint", dy: 1, brow: "worry" },
    { eyes: "closed", brow: "worry" },
    { eyes: "closed" },
  ],
};
const PICKS = ["hop", "wink", "headturn", "ruffle", "hoot"] ;

/** One still pose per state, used when the system asks for reduced motion. */
const STILL                          = {
  idle: {},
  thinking: { look: [1, -1], brow: "down", dots: 3 },
  working: { laptop: 0, brow: "down", look: [0, 1] },
  waiting: { wingR: "up", tufts: "perk", brow: "up", tilt: 1 },
  success: { eyes: "happy", brow: "up" },
  error: { eyes: "squint", brow: "worry", tufts: "droop" },
  sleeping: { eyes: "closed", brow: "rest", z: 1, dy: 1 },
};

/** Ease a looping value through a keyframe list at ~1 frame per entry. */
const step = (seq              , t        ) => seq[Math.max(0, Math.floor(t / FRAME_MS)) % seq.length];

function statePose(state           , tRaw        )       {
  const t = Math.max(0, tRaw); // a state change can make elapsed briefly negative
  const f = Math.floor(t / FRAME_MS);
  switch (state) {
    case "idle": {
      // Breathing: a slow 1px rise and fall; the odd tuft twitch.
      const breath = Math.sin(t / 900) > 0.6 ? -1 : 0;
      const twitch = f % 47 === 0 ? ("perk" ) : undefined;
      return { dy: breath, tufts: twitch };
    }
    case "thinking": {
      // Pupils sweep behind the glasses; brow furrows; a tuft flicks; dots pulse.
      const sweep = step([-1, -1, 0, 1, 1, 0], t)              ;
      return {
        look: [sweep, -1],
        brow: "down",
        tilt: f % 18 < 2 ? 1 : 0,
        dots: 1 + (Math.floor(t / 300) % 3),
      };
    }
    case "working": {
      const phase = (Math.floor(t / 150) % 2)         ;
      const glanceUp = f % 26 < 3; // checks in with you now and then
      return {
        laptop: phase,
        tick: Math.floor(t / 420),
        brow: "down",
        look: glanceUp ? [0, 0] : [0, 1],
        wingL: phase ? "mid" : "down",
        wingR: phase ? "down" : "mid",
      };
    }
    case "waiting": {
      const wave = step(["mid", "up", "up", "mid"], t);
      return { wingR: wave, tufts: "perk", brow: "up", tilt: 1, look: [1, 1] };
    }
    case "success": {
      const p = step(
        [
          { dy: 1, squash: -1 },
          { dy: -3, squash: 1, wingL: "up", wingR: "up" },
          { dy: -5, squash: 1, wingL: "up", wingR: "up" },
          { dy: -5, wingL: "mid", wingR: "mid" },
          { dy: -2, wingL: "mid", wingR: "mid" },
          { dy: 1, squash: -1, wingL: "down", wingR: "down" },
          {},
          {},
        ],
        t,
      );
      return { eyes: "happy", brow: "up", ...p };
    }
    case "error":
      return { eyes: "squint", brow: "worry", tufts: "droop", tilt: f % 6 < 3 ? -1 : 1, dy: 1 };
    case "sleeping":
      return {
        eyes: "closed",
        tufts: "droop",
        dy: 1 + (Math.sin(t / 1600) > 0 ? 1 : 0),
        z: Math.floor(t / 650) % 3,
      };
    default:
      return {};
  }
}


  /* Nilo as a component. Same loop as NiloSprite.tsx: 110ms frames, blink, glance, pointer follow, click reactions, sleep. */
  function Nilo(props) {
    var state = props.state || "idle", cell = props.cell || 6, crop = props.crop || "full", interactive = !!props.interactive;
    var svgRef = React.useRef(null);
    var s1 = React.useState(0), now = s1[0], setNow = s1[1];
    var s2 = React.useState(null), bubble = s2[0], setBubble = s2[1];
    var life = React.useRef({ since: 0, lastActive: 0, blinkAt: 0, blinkUntil: 0, glance: [0, 0], glanceAt: 0, pointer: null, reaction: null, clicks: [], still: false });
    React.useEffect(function () {
      var l = life.current;
      l.since = l.lastActive = performance.now();
      l.still = props.still != null ? !!props.still : (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      setNow(l.since);
      if (l.still) return;
      var id = window.setInterval(function () { setNow(performance.now()); }, FRAME_MS);
      return function () { window.clearInterval(id); };
    }, [props.still]);
    React.useEffect(function () { life.current.since = performance.now(); }, [state]);
    React.useEffect(function () {
      if (!interactive) return;
      function onMove(e) {
        var l = life.current; l.lastActive = performance.now();
        var r = svgRef.current && svgRef.current.getBoundingClientRect(); if (!r) return;
        var vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height * 0.4), dead = r.width / 3;
        l.pointer = Math.hypot(vx, vy) > 480 ? null : [Math.abs(vx) > dead ? Math.sign(vx) : 0, vy < -dead ? -1 : vy > dead * 1.6 ? 1 : 0];
      }
      window.addEventListener("pointermove", onMove);
      return function () { window.removeEventListener("pointermove", onMove); };
    }, [interactive]);
    var l = life.current;
    var asleep = interactive && state === "idle" && now - l.lastActive > SLEEP_AFTER_MS;
    var shown = asleep ? "sleeping" : state, pose;
    if (l.still) pose = STILL[shown];
    else {
      if (now > l.blinkAt) { l.blinkUntil = now + 140; l.blinkAt = now + 2400 + Math.random() * 3600; }
      if (now > l.glanceAt) { l.glance = GLANCES[Math.floor(Math.random() * GLANCES.length)]; l.glanceAt = now + 1400 + Math.random() * 2600; }
      pose = Object.assign({ look: l.pointer || l.glance, tufts: l.pointer && shown === "idle" ? "perk" : undefined }, statePose(shown, now - l.since));
      if (!pose.eyes && now < l.blinkUntil) pose.eyes = "closed";
      var r = l.reaction;
      if (r) { var i = Math.floor((now - r.start) / FRAME_MS); if (i < r.frames.length) pose = Object.assign({}, pose, { eyes: undefined }, r.frames[i]); else l.reaction = null; }
    }
    var rows = niloFrame(pose).slice(0, crop === "face" ? 12 : NILO_CANVAS.h);
    var svg = h("svg", { ref: svgRef, role: interactive || !props.label ? undefined : "img", "aria-label": interactive ? undefined : props.label,
      "aria-hidden": interactive || !props.label ? true : undefined, viewBox: "0 0 " + NILO_CANVAS.w + " " + rows.length,
      width: NILO_CANVAS.w * cell, height: rows.length * cell, shapeRendering: "crispEdges", style: { display: "block" } },
      cellPaths(rows).map(function (p) { return h("path", { key: p[0], fill: p[0], d: p[1] }); }));
    if (!interactive) return svg;
    function onClick() {
      if (l.still) return;
      var at = performance.now(); l.lastActive = at;
      l.clicks = l.clicks.filter(function (c) { return at - c < 1500; }).concat(at);
      var name = l.clicks.length >= 5 ? "dizzy" : PICKS[Math.floor(Math.random() * PICKS.length)];
      if (name === "dizzy") l.clicks = [];
      l.reaction = { frames: REACTIONS[name], start: at };
      if (name === "hoot" || name === "dizzy") { setBubble(name === "dizzy" ? "@_@" : "hoo!"); window.setTimeout(function () { setBubble(null); }, 900); }
    }
    return h("button", { type: "button", onClick: onClick, "aria-label": props.label || "Nilo", className: cx("oh-nilo", props.className) },
      svg, bubble ? h("span", { className: "oh-nilo-bubble", "aria-hidden": "true" }, bubble) : null);
  }


  /* ── Added with the component docs (docs/design-system/components): Notice, EmptyState, Segmented, StatusMark, ConfirmInline, Skeleton, Popover ── */
  var ICONS = {
    info: "M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    warn: "M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
    fault: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"
  };
  function Icon(props) {
    return h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", className: props.className },
      h("path", { d: ICONS[props.name] }));
  }

  function Notice(props) {
    var tone = props.tone || "info";
    return h("div", { className: cx("oh-notice", "oh-notice--" + tone, props.className), role: props.role || (tone === "fault" ? "alert" : "status") },
      h(Icon, { name: tone, className: "oh-notice__icon" }),
      h("div", { className: "oh-notice__body" },
        props.title ? h("p", { className: "oh-notice__title" }, props.title) : null,
        props.children ? h("div", { className: "oh-notice__text" }, props.children) : null),
      props.action ? h("div", { className: "oh-notice__action" }, props.action) : null);
  }

  function EmptyState(props) {
    return h("div", { className: cx("oh-empty", props.className) },
      h("p", { className: "oh-empty__title" }, props.title),
      props.children ? h("p", { className: "oh-empty__text" }, props.children) : null,
      props.action || null);
  }

  function Segmented(props) {
    var refs = React.useRef([]);
    var opts = props.options;
    function move(from, step) {
      var enabled = opts.filter(function (o) { return !o.disabled; });
      var at = enabled.indexOf(opts[from]);
      var next = enabled[(at + step + enabled.length) % enabled.length];
      props.onChange(next.value);
      var el = refs.current[opts.indexOf(next)]; if (el) el.focus();
    }
    return h("div", { role: "radiogroup", "aria-label": props.label, className: cx("oh-seg", props.className) },
      opts.map(function (o, i) {
        var on = o.value === props.value;
        return h("button", {
          key: o.value, type: "button", role: "radio", "aria-checked": on ? "true" : "false", title: o.hint, disabled: o.disabled,
          tabIndex: on ? 0 : -1, className: "oh-seg__opt",
          ref: function (el) { refs.current[i] = el; },
          onClick: function () { props.onChange(o.value); },
          onKeyDown: function (e) {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
          }
        }, o.label);
      }));
  }

  /* The one state marker: an 8px square beside the word that names the state. Decorative. */
  function StatusMark(props) {
    return h("span", { className: cx("oh-mark", "oh-mark--" + (props.tone || "idle"), props.className), "aria-hidden": "true" });
  }

  function ConfirmInline(props) {
    var box = React.useRef(null);
    /* Cancel is the first button, and it has the focus on arrival. */
    React.useEffect(function () { var b = box.current && box.current.querySelector("button"); if (b) b.focus(); }, []);
    return h("div", { ref: box, role: "group", "aria-label": props.confirmLabel, className: cx("oh-confirm", props.className),
      onKeyDown: function (e) { if (e.key === "Escape" && !props.busy) props.onCancel(); } },
      h("span", { className: "oh-confirm__prompt" }, props.prompt),
      h(Button, { onClick: props.onCancel, disabled: props.busy }, props.cancelLabel || "Cancel"),
      h(Button, { variant: "danger", onClick: props.onConfirm, loading: props.busy }, props.confirmLabel));
  }

  function Skeleton(props) { return h("div", { "aria-hidden": "true", className: cx("oh-skel", props.className) }); }

  /* A static popover list: groups of options with a tone mark, a detail and a selected state (the model picker). */
  function Popover(props) {
    return h("div", { className: cx("oh-pop", props.className) },
      props.header ? h("p", { className: "oh-pop__head" }, props.header) : null,
      props.search ? h("div", { className: "oh-pop__search" }, h("input", { className: "oh-input__field", placeholder: props.search, "aria-label": props.search })) : null,
      props.panel || null,
      h("div", { role: "listbox", "aria-label": props.label, className: "oh-pop__list" },
        props.groups.map(function (g, gi) {
          return h("div", { key: gi, role: g.title ? "group" : undefined, "aria-label": g.title },
            g.title ? h("p", { className: "oh-pop__group" }, g.title) : null,
            g.options.map(function (o, oi) {
              return h("div", { key: oi, role: "option", "aria-selected": o.selected ? "true" : "false", "aria-disabled": o.disabled ? "true" : undefined, className: "oh-opt" },
                o.tone ? h(StatusMark, { tone: o.tone }) : null,
                h("span", { className: "oh-opt__main" }, h("span", { className: "oh-opt__label" }, o.label), o.detail ? h("span", { className: "oh-opt__detail" }, o.detail) : null));
            }));
        })),
      props.footer ? h("div", { className: "oh-pop__foot" }, props.footer) : null);
  }

  window.OH = { Nilo: Nilo, Button: Button, Input: Input, Badge: Badge, Panel: Panel, ListRow: ListRow, Kbd: Kbd, Notice: Notice, EmptyState: EmptyState, Segmented: Segmented, StatusMark: StatusMark, ConfirmInline: ConfirmInline, Skeleton: Skeleton, Popover: Popover };
})();
