import React from "react";
import { Suggestions, Suggestion } from "../ui";

interface QuickReplyButtonsProps {
  options: string[];
  onSelect: (option: string) => void;
  disabled?: boolean;
}

/**
 * Displays quick-reply buttons for agent questions.
 * When the agent asks a yes/no or multiple-choice question,
 * this component shows clickable options for easy response.
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
        {options.map((option, index) => (
          <Suggestion
            key={index}
            suggestion={option}
            onClick={() => onSelect(option)}
            disabled={disabled}
          />
        ))}
      </Suggestions>
    </div>
  );
}
