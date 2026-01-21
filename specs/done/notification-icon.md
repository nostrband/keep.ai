# Spec: Create Notification Icon

## Problem
The Electron notification code references `apps/electron/assets/icon.png` but this file doesn't exist. Notifications show with a missing or default system icon instead of app branding.

## Solution
Create the notification icon based on the existing "K in square" logo used in the app header. The icon should be visually consistent with the app's branding.

## Requirements
- Create `apps/electron/assets/` directory
- Generate `icon.png` at appropriate size for notifications (256x256 or 512x512)
- Icon should match the "K in square" HTML/CSS icon from the header
- Should look good on both light and dark system backgrounds

## Reference
The source design is the K logo used in the web app header - replicate that design as a PNG image file.

## Files to create
- `apps/electron/assets/icon.png`
