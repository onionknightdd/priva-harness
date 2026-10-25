export function gitStatusClass(status: string) {
  if (status === "!" || status === "U" || status === "D") return "text-status-error"
  if (status === "A" || status === "?") return "text-status-success"
  if (status === "R" || status === "C") return "text-status-warm"
  return "text-status-warning"
}
