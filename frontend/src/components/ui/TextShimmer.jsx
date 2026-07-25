export default function TextShimmer({ children, className = "" }) {
  return (
    <span className={`text-shimmer ${className}`}>
      {children}
    </span>
  );
}
