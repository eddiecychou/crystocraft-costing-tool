export default function LoadingBar() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-brand-100 overflow-hidden">
      <div className="h-full bg-brand-600 animate-pulse w-full origin-left" style={{ animation: 'loading 1.5s ease-in-out infinite' }} />
      <style>{`
        @keyframes loading {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
