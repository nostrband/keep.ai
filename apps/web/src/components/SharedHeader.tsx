import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Button,
} from "../ui";
import { useAgentStatus } from "../hooks/dbApiReads";

// Logo component with "K" design
const AssistantIcon = () => (
  <div className="w-8 h-8 border-2 rounded flex items-center justify-center" style={{ borderColor: '#D6A642' }}>
    <span className="font-bold text-lg">K</span>
  </div>
);

interface SharedHeaderProps {
  title: string;
  subtitle?: string;
}

export default function SharedHeader({ title, subtitle }: SharedHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: agentStatus } = useAgentStatus();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-4xl mx-auto px-6 py-2">
        <div className="flex items-center justify-between">
          <div className="h-10 flex items-center gap-3">
            <AssistantIcon />
            <div>
              <h1 className="text-lg font-bold text-gray-900">{title}</h1>
              {title === "Assistant" && agentStatus && (
                <p className="text-xs text-gray-500">{agentStatus}</p>
              )}
              {subtitle && (
                <p className="text-sm text-gray-600">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="relative" ref={dropdownRef}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 cursor-pointer"
              onClick={() => setIsOpen(!isOpen)}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </Button>
            {isOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                <div className="py-1">
                  <Link
                    to="/chat/main"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Assistant
                  </Link>
                  <Link
                    to="/tasks"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Tasks
                  </Link>
                  <Link
                    to="/threads"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Threads
                  </Link>
                  <Link
                    to="/notes"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Notes
                  </Link>
                  <Link
                    to="/devices"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Devices
                  </Link>
                  <Link
                    to="/console"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Console
                  </Link>
                  <Link
                    to="/settings"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    Settings
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}