import { useState } from "react"
import Form from "@rjsf/core"
import validator from "@rjsf/validator-ajv8"
import { ADDITIONAL_PROPERTY_FLAG, canExpand, descriptionId, errorId, type ArrayFieldItemTemplateProps, type ArrayFieldTemplateProps, type DescriptionFieldProps, type FieldErrorProps, type FieldTemplateProps, type ObjectFieldTemplateProps, type RJSFSchema } from "@rjsf/utils"
import { ArrowDownIcon, ArrowUpIcon, PlayIcon, PlusIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToolArrayField } from "./mcp-tool-string-list"
import { ToolBoolean, ToolInput, ToolSelect, ToolTextarea } from "./mcp-tool-widgets"

function FieldTemplate(props: FieldTemplateProps) {
  const { t } = useTranslation()
  const { id, label, required, displayLabel, hidden, children, errors, help, description, schema, disabled, readonly, onKeyRenameBlur, onRemoveProperty } = props
  if (hidden) return <div hidden>{children}</div>
  return <div className="min-w-0 space-y-2">
    {ADDITIONAL_PROPERTY_FLAG in schema && <div className="flex items-center gap-2">
      <Input id={`${id}-key`} aria-label={t("resources.parameterKey")} defaultValue={label} onBlur={onKeyRenameBlur} disabled={disabled || readonly} />
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemoveProperty} disabled={disabled || readonly} aria-label={t("resources.removeValue", { value: label })}><XIcon /></Button>
    </div>}
    {displayLabel && <Label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</Label>}
    {children}
    {displayLabel && description}{errors}{help}
  </div>
}

function Description({ id, description }: DescriptionFieldProps) {
  return description ? <p id={id} className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{description}</p> : null
}

function FieldErrors({ errors, fieldPathId }: FieldErrorProps) {
  return errors?.length ? <ul id={errorId(fieldPathId)} role="alert" className="space-y-1 text-xs text-destructive">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null
}

function ObjectTemplate({ title, description, fieldPathId, properties, schema, uiSchema, formData, disabled, readonly, onAddProperty }: ObjectFieldTemplateProps) {
  const { t } = useTranslation()
  return <fieldset className="min-w-0 space-y-4">
    {title && <legend className="mb-2 text-sm font-medium">{title}</legend>}
    {description && <p id={descriptionId(fieldPathId)} className="text-xs text-muted-foreground">{description}</p>}
    {properties.map((property) => property.content)}
    {canExpand(schema, uiSchema, formData) && <Button type="button" variant="outline" size="sm" onClick={onAddProperty} disabled={disabled || readonly}><PlusIcon />{t("resources.addParameter")}</Button>}
  </fieldset>
}

function ArrayTemplate({ title, required, schema, fieldPathId, items, canAdd, onAddClick, disabled, readonly }: ArrayFieldTemplateProps) {
  const { t } = useTranslation()
  return <fieldset className="min-w-0 space-y-3">
    <legend className="mb-2 text-sm font-medium">{title}{required && <span aria-hidden="true"> *</span>}</legend>
    {schema.description && <p id={descriptionId(fieldPathId)} className="text-xs text-muted-foreground">{schema.description}</p>}
    {items}
    {canAdd && <Button type="button" variant="outline" size="sm" disabled={disabled || readonly} onClick={onAddClick}><PlusIcon />{t("resources.addArrayItem")}</Button>}
  </fieldset>
}

function ArrayItem({ children, buttonsProps, hasToolbar }: ArrayFieldItemTemplateProps) {
  const { t } = useTranslation()
  const { hasRemove, hasMoveUp, hasMoveDown, onRemoveItem, onMoveUpItem, onMoveDownItem, disabled, readonly, index } = buttonsProps
  return <div className="flex min-w-0 items-start gap-2 rounded-md border border-border p-3">
    <div className="min-w-0 flex-1">{children}</div>
    {hasToolbar && <div className="flex shrink-0 gap-1">
      {hasMoveUp && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || readonly} onClick={onMoveUpItem} aria-label={t("resources.moveItemUp")}><ArrowUpIcon /></Button>}
      {hasMoveDown && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || readonly} onClick={onMoveDownItem} aria-label={t("resources.moveItemDown")}><ArrowDownIcon /></Button>}
      {hasRemove && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || readonly} onClick={onRemoveItem} aria-label={t("resources.removeArrayItem", { index: index + 1 })}><XIcon /></Button>}
    </div>}
  </div>
}

const templates = { BaseInputTemplate: ToolInput, FieldTemplate, DescriptionFieldTemplate: Description, FieldErrorTemplate: FieldErrors, ObjectFieldTemplate: ObjectTemplate, ArrayFieldTemplate: ArrayTemplate, ArrayFieldItemTemplate: ArrayItem }
const widgets = { CheckboxWidget: ToolBoolean, SelectWidget: ToolSelect, TextareaWidget: ToolTextarea }
const fields = { ArrayField: ToolArrayField }
const defaultFormState = { arrayMinItems: { populate: "never" as const } }

export function McpToolForm({ schema, running, onSubmit }: { schema: RJSFSchema; running: boolean; onSubmit: (args: Record<string, unknown>) => void }) {
  const { t } = useTranslation()
  const [data, setData] = useState<Record<string, unknown>>({})
  const [invalid, setInvalid] = useState(false)
  return <Form<Record<string, unknown>> schema={schema} validator={validator} formData={data} onChange={(event) => { setData(event.formData ?? {}); setInvalid(false) }}
    onSubmit={(event) => onSubmit(event.formData ?? {})} onError={() => setInvalid(true)} disabled={running} templates={templates} widgets={widgets} fields={fields}
    className="space-y-5" showErrorList={false} focusOnFirstError experimental_defaultFormStateBehavior={defaultFormState} uiSchema={{ "ui:options": { label: false } }}>
    {invalid && <p role="alert" className="text-sm text-destructive">{t("resources.invalidParameters")}</p>}
    <Button type="submit" disabled={running}><PlayIcon />{t(running ? "resources.testing" : "resources.runTool")}</Button>
  </Form>
}
