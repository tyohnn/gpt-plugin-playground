import { cn } from "cn"

import { Loader } from "@host-playground/ui/icons"
import { strings } from "@host-playground/ui/strings"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader
      data-slot="spinner"
      role="status"
      aria-label={strings.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
