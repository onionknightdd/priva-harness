/* oxlint-disable react/only-export-components */
import * as React from "react"

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive"

export const sandboxComponents = {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Progress,
  Separator,
}

function Button({
  variant = "default",
  type = "button",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: ButtonVariant }) {
  const variantClass =
    variant === "outline"
      ? " vs-btn-outline"
      : variant === "secondary"
        ? " vs-btn-secondary"
        : variant === "ghost"
          ? " vs-btn-ghost"
          : variant === "destructive"
            ? " vs-btn-destructive"
            : ""
  return (
    <button
      type={type}
      className={`vs-btn${variantClass}${className ? ` ${className}` : ""}`}
      {...props}
    />
  )
}

function Badge({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<"span"> & { variant?: string }) {
  const variantClass = variant === "default" ? "" : ` vs-badge-${variant}`
  return (
    <span
      className={`vs-badge${variantClass}${className ? ` ${className}` : ""}`}
      {...props}
    />
  )
}

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={merge("vs-card", className)} {...props} />
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={merge("vs-card-header", className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={merge("vs-card-title", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={merge("vs-card-description", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={merge("vs-card-content", className)} {...props} />
}

function Progress({
  value = 0,
  className,
  ...props
}: React.ComponentProps<"div"> & { value?: number }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div
      className={merge("vs-progress", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div className="vs-progress-bar" style={{ width: `${String(pct)}%` }} />
    </div>
  )
}

function Separator({ className, ...props }: React.ComponentProps<"hr">) {
  return <hr className={merge("vs-separator", className)} {...props} />
}

function merge(base: string, className: string | undefined) {
  return className ? `${base} ${className}` : base
}
