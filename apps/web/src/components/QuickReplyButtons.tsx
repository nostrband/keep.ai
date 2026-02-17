// TODO v2: QuickReplyButtons disabled for v1. Structured asks not yet ready.
import React from "react";
import { Suggestions, Suggestion, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../ui";

// Maximum visible character length for quick-reply options
// Longer options are truncated with ellipsis and show full text on hover
const MAX_OPTION_LENGTH = 60;

interface QuickReplyButtonsProps {
  options: string[];
  onSelect: (option: string) => void;
  disabled?: boolean;
}

/**
 * Truncate text to max length with ellipsis
 */
function truncateOption(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Displays quick-reply buttons for agent questions.
 * When the agent asks a yes/no or multiple-choice question,
 * this component shows clickable options for easy response.
 * Long options are truncated with ellipsis and show full text on hover.
 */
export function QuickReplyButtons({
  options,
  onSelect,
  disabled = false,
}: QuickReplyButtonsProps) {
  if (!options || options.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      <div className="text-xs text-gray-500 mb-2">Quick replies:</div>
      <Suggestions>
        <TooltipProvider>
          {options.map((option, index) => {
            const isTruncated = option.length > MAX_OPTION_LENGTH;
            const displayText = truncateOption(option, MAX_OPTION_LENGTH);

            // If truncated, wrap in tooltip to show full text on hover
            if (isTruncated) {
              return (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    <span>
                      <Suggestion
                        suggestion={option}
                        onClick={() => onSelect(option)}
                        disabled={disabled}
                      >
                        {displayText}
                      </Suggestion>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {option}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Suggestion
                key={index}
                suggestion={option}
                onClick={() => onSelect(option)}
                disabled={disabled}
              />
            );
          })}
        </TooltipProvider>
      </Suggestions>
    </div>
  );
}
