import { NILO_FACE, cellPaths } from "@/components/brand/niloGrid";

const PATHS = cellPaths(NILO_FACE);
const W = NILO_FACE[0].length;
const H = NILO_FACE.length;

/** OHarness' compact mark: Nilo's face, cropped from the mascot sprite.
    `cell` is CSS px per grid cell; keep it an integer so edges stay crisp. */
export function Mark({ cell = 2 }: { cell?: number }) {
  return (
    <svg
      width={W * cell}
      height={H * cell}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="flex-none"
    >
      {PATHS.map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}
