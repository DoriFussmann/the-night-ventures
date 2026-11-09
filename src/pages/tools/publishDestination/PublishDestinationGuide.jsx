import React from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PUBLISH_GUIDE } from "../../../../lib/publish-destination/guide.js";

/** Step-by-step setup guide shown at the top of the Publish Destination dialog. */
export default function PublishDestinationGuide({ defaultOpen = false }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-md border border-border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-medium text-foreground">
          How to set this up (3 parts, about 5 minutes)
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-t border-border px-3 py-3">
          {PUBLISH_GUIDE.map((part, index) => (
            <section key={part.where} className="space-y-1.5">
              <h3 className="text-xs font-semibold text-foreground">
                Part {index + 1} — {part.where}: {part.goal}
              </h3>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                {part.steps.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
