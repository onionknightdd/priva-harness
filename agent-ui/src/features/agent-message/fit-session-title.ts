const titleCharacters = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const titleEllipsis = "……"

export function fitSessionTitle(
  title: string,
  availableWidth: number,
  measureWidth: (text: string) => number
) {
  if (availableWidth <= 0) return ""
  if (measureWidth(title) <= availableWidth) return title
  if (measureWidth(titleEllipsis) > availableWidth) return ""

  const boundaries = [
    0,
    ...Array.from(titleCharacters.segment(title), ({ index, segment }) => index + segment.length),
  ]
  let first = 0
  let last = boundaries.length - 2

  while (first < last) {
    const middle = Math.ceil((first + last) / 2)
    const candidate = title.slice(0, boundaries[middle]) + titleEllipsis
    if (measureWidth(candidate) <= availableWidth) {
      first = middle
    } else {
      last = middle - 1
    }
  }

  return title.slice(0, boundaries[first]) + titleEllipsis
}
