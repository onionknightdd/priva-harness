import { useTranslation } from "react-i18next"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const rows = ["tasks", "guidance", "tools", "resources", "permissions"] as const

export function ModeComparisonDialog() {
  const { t } = useTranslation()
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[35rem]">
      <DialogHeader className="pr-6">
        <DialogTitle>{t("sidebar.modes.comparison.title")}</DialogTitle>
        <DialogDescription>{t("sidebar.modes.comparison.description")}</DialogDescription>
      </DialogHeader>
      <table className="w-full table-fixed border-collapse text-left text-sm leading-relaxed">
        <thead>
          <tr className="border-b">
            <th scope="col" className="w-1/4 p-2 font-medium text-muted-foreground">{t("sidebar.modes.comparison.dimension")}</th>
            <th scope="col" className="p-2 font-medium">Agent</th>
            <th scope="col" className="p-2 font-medium">Code</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row} className="border-b last:border-0">
              <th scope="row" className="p-2 align-top font-medium text-muted-foreground">{t(`sidebar.modes.comparison.${row}.label`)}</th>
              <td className="p-2 align-top break-words">{t(`sidebar.modes.comparison.${row}.agent`)}</td>
              <td className="p-2 align-top break-words">{t(`sidebar.modes.comparison.${row}.code`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">{t("sidebar.modes.locked")}</p>
    </DialogContent>
  )
}
