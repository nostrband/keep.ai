import React from 'react';
import { useNavigate } from 'react-router-dom';
import { EVENT_CONFIGS, EventType, EventPayload } from '../types/events';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui';

interface EventItemProps {
  type: EventType;
  content: EventPayload;
  timestamp: string;
  usage?: { cost?: number };
}

export function EventItem({ type, content, timestamp, usage }: EventItemProps) {
  const navigate = useNavigate();
  const config = EVENT_CONFIGS[type];

  if (!config) {
    console.warn(`Unknown event type: ${type}`);
    return null;
  }

  const title = config.title(content);
  const hasNavigation = config.hasId && config.getEntityPath;

  const handleEventClick = () => {
    if (hasNavigation && config.getEntityPath) {
      navigate(config.getEntityPath(content));
    }
  };

  const handleViewEntity = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasNavigation && config.getEntityPath) {
      navigate(config.getEntityPath(content));
    }
  };

  return (
    <div
      className={`
        flex items-center justify-between px-2 py-1 my-1
        border border-gray-100 rounded-full bg-gray-50
        text-gray-500 text-sm
        ${hasNavigation ? 'cursor-pointer hover:bg-gray-100' : ''}
        ${/* Desktop: single line */ ''}
      `}
      onClick={handleEventClick}
    >
      <div className="flex items-center flex-1 min-w-0 gap-2">
        <span className="text-base mr-2 flex-shrink-0" aria-label={`${type} event`}>
          {config.emoji}
        </span>
        <span
          className={`
            truncate
            ${/* Mobile: allow 2 lines, desktop: 1 line */ ''}
            sm:line-clamp-1 line-clamp-2
          `}
          title={title}
        >
          {title}
        </span>
        {/* Show cost if available */}
        {usage?.cost != null && usage.cost > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
            <span>💵</span>
            <span>{usage.cost.toFixed(2)}</span>
          </span>
        )}
      </div>
      
      {/* Only show dropdown when there are actions available */}
      {hasNavigation ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
              aria-label="Event actions"
            >
              ···
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleViewEntity}>
              <span className="mr-2">👁️</span>
              View details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        /* Spacer to maintain consistent layout with items that have menus */
        <div className="ml-2 px-2 py-1 flex-shrink-0 w-[34px]" />
      )}
    </div>
  );
}