import React from "react";
import { Button, Input, Badge, Avatar, AvatarFallback } from "@app/ui";

export function TestUIComponents() {
  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <h2>UI Components Test</h2>
      
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Button variant="default">Default Button</Button>
        <Button variant="outline">Outline Button</Button>
        <Button variant="secondary">Secondary Button</Button>
      </div>
      
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Badge>Default Badge</Badge>
        <Badge variant="secondary">Secondary Badge</Badge>
        <Badge variant="outline">Outline Badge</Badge>
      </div>
      
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Avatar>
          <AvatarFallback>UI</AvatarFallback>
        </Avatar>
        <Input placeholder="Test input..." />
      </div>
    </div>
  );
}