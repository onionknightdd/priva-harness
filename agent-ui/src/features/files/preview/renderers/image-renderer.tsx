export function ImageRenderer({
  alt,
  source,
}: {
  alt: string
  source: string
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-muted/20 p-6">
      <img
        src={source}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
      />
    </div>
  )
}
