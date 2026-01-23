# Spec: Fix Autonomy Toggle Triggering Form Submission

## Problem
When a user types text on the homepage and clicks the "AI decides" / "Coordinate with me" toggle switch without submitting, the form submits unexpectedly and redirects to `/chat/<id>`. The agent doesn't start running because the submission was unintentional.

## Root Cause
The autonomy toggle button in MainPage.tsx lacks the `type="button"` attribute. In HTML, buttons inside a form default to `type="submit"`. When clicked, this triggers the form's `onSubmit` handler instead of just toggling the autonomy mode.

## Location
`apps/web/src/components/MainPage.tsx` lines 358-364

The problematic code:
```tsx
<button
  onClick={toggleAutonomyMode}
  className="..."
>
  <span>{autonomyMode === 'ai_decides' ? 'AI decides' : 'Coordinate'}</span>
  <Info className="size-3" />
</button>
```

## Solution
Add `type="button"` to the autonomy toggle button to prevent it from triggering form submission.

## Changes
```tsx
<button
  type="button"
  onClick={toggleAutonomyMode}
  className="..."
>
```

## Expected Outcome
- Clicking the autonomy toggle only changes the autonomy mode preference
- Form is not submitted when clicking the toggle
- User remains on the homepage with their typed text intact
- No redirect to `/chat/<id>` occurs
