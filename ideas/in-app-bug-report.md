# Idea: In-App Bug Report / Contact Support

## Overview

When users encounter internal errors (bugs in our code), they currently see "contact support" but have no easy way to do so. This feature would add a "Contact Support" action that opens a bug report form pre-filled with relevant context.

## User Flow

1. User sees error notification: "Something went wrong. Please contact support."
2. User clicks "Contact Support" button/link
3. Bug report form opens (in-app or modal), pre-filled with:
   - Error type and message
   - Workflow ID and name
   - Script run ID
   - Timestamp
   - Relevant logs (sanitized)
   - App version
4. User can add description of what they were trying to do
5. User submits report
6. Report sent to support system (email, ticketing system, etc.)
7. User sees confirmation: "Report submitted. We'll look into it."

## Pre-filled Information

Automatically include (with user consent):
- Error details (type, message, stack trace)
- Workflow context (ID, name, script summary)
- Recent script run logs (last N lines, sanitized)
- Timestamps (when error occurred, when reported)
- App/client version
- Device/platform info (optional)

Sanitize to remove:
- API keys and secrets
- Personal data from workflow content
- Sensitive file paths

## Implementation Components

### Frontend
- "Contact Support" action button in error notifications
- Bug report form/modal component
- Pre-fill logic to gather context
- Sanitization before sending

### Backend
- Endpoint to receive bug reports
- Forward to support system (email, Zendesk, GitHub Issues, etc.)
- Store reports for tracking (optional)

### Support System Integration Options
- Email to support address (simplest)
- GitHub Issues API (if open-source support preferred)
- Zendesk/Intercom/other ticketing system
- Custom support dashboard

## Privacy Considerations

- Show user what data will be sent before submission
- Allow user to remove/edit sensitive parts
- Clear data retention policy
- Option to submit anonymously?

## Future Enhancements

- Screenshot attachment
- Screen recording of issue
- Live chat option
- FAQ/help articles before submitting
- Status tracking for submitted reports
- Auto-suggested solutions based on error type

## Priority

Medium - improves user experience when things go wrong, but requires support infrastructure to be useful.
