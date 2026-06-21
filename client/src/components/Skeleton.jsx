export function Skeleton({
  width = "100%",
  height = 16,
  radius = 999,
  className = "",
  style = {},
}) {
  const normalizedWidth =
    typeof width === "number" ? `${width}px` : width;

  const normalizedHeight =
    typeof height === "number" ? `${height}px` : height;

  const normalizedRadius =
    typeof radius === "number" ? `${radius}px` : radius;

  return (
    <div
      className={`fb-skeleton ${className}`}
      style={{
        width: normalizedWidth,
        height: normalizedHeight,
        borderRadius: normalizedRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCircle({ size = 48, className = "" }) {
  return (
    <Skeleton
      width={size}
      height={size}
      radius="999px"
      className={className}
    />
  );
}

export function SkeletonCard({ className = "", children }) {
  return (
    <div className={`fb-skeleton-card ${className}`} aria-hidden="true">
      {children || (
        <>
          <SkeletonCircle size={54} />
          <div className="fb-skeleton-card-lines">
            <Skeleton width="58%" height={18} />
            <Skeleton width="86%" height={14} />
            <Skeleton width="72%" height={14} />
          </div>
        </>
      )}
    </div>
  );
}

export function SkeletonButton({ width = 160, className = "" }) {
  return (
    <Skeleton
      width={width}
      height={44}
      radius="999px"
      className={className}
    />
  );
}

export function SkeletonField({ className = "" }) {
  return (
    <div className={`fb-skeleton-field ${className}`}>
      <Skeleton width="36%" height={12} />
      <Skeleton width="100%" height={52} radius={16} />
    </div>
  );
}