// src/lib/utils.ts
export function getWeekDay(date = new Date()) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
}

export function createPlannerTaskPrompt() {
  return `
1. Use "current-time" tag appended to this message to understand which date/time and day of the week is today.
2. Review your notes, reminters, weather forecast and user's schedule for today. 
3. Figure out when it makes sense to send proactive messages to user to greet, remind, ask or suggest, as a diligent assistant would. 
4. Make a table of <time>: <message>, make sure to use user's local time.
5. Drop rows where <time> already passed (less than current time).
6. For each message left in the table, use add-task tool to schedule sending the message at the corresponding time.
7. Make sure to take into account user's feedback on your daily proactive messages.
8. After changing task list, use list-tasks tool to confirm that all changes were applied properly.
`;
}