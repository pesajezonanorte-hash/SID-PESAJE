# Mobile Calendar Testing Guide

## Quick Start: View Changes in Action

### 1. Start the Development Server
```bash
cd c:\Users\Administrator\Desktop\sidpesajeee
python3 -m http.server 8000
```
Then open: **http://localhost:8000**

### 2. Test on Desktop (1024px+)
1. Open browser on desktop machine
2. Go to admin panel
3. Click "Agenda" in sidebar
4. You should see:
   - ✅ 7-column calendar grid
   - ✅ Event pills in day cells
   - ✅ Centered modals (max-width ~400px)
   - ✅ Drag-drop ghost preview visible when dragging events
   - ✅ Smooth animations on modal entrance

### 3. Test on Mobile (< 768px)
#### Option A: Device Developer Tools
1. Open DevTools (F12)
2. Click "Toggle device toolbar" (Ctrl+Shift+M)
3. Set to "iPhone 12" or "Pixel 5" preset
4. Resize window to < 768px
5. Reload page (Ctrl+R)

#### Option B: Real Mobile Device
1. Get your computer's IP address: `ipconfig` (find IPv4 Address)
2. On mobile, open: `http://<YOUR_IP>:8000`
3. Make sure both devices are on same WiFi

#### Option C: Responsive Design Mode
1. Right-click → "Inspect Element"
2. Device toolbar at top (top-left icon)
3. Select iPhone or Android device
4. Reload page

### 4. Mobile View - What You Should See

#### Week Strip (Horizontal Scroll)
```
┌─────────────────────────────┐
│ D  │ L  │ M  │ X  │ J  │... │
│ 24 │ 25 │ 26 │ 27 │ 28 │    │
└─────────────────────────────┘
         ↑ (selected, red border)
```
- **D/L/M/X/J/V/S** = Day letters (Spanish)
- Red border around selected day
- Red circle highlight for "today"
- Swipe left/right to scroll

#### Events List (Full-Width Cards)
```
┌──────────────────────────────┐
│ 10:00 AM                      │ ← Time
│ Reunión con Juan              │ ← Full title
│ ⏱ 60min  📌 Admin  ✓ Confirmada │ ← Metadata
└──────────────────────────────┘
     (Blue left border = meeting)

┌──────────────────────────────┐
│ 02:00 PM                      │
│ Servicio - Cliente XYZ        │
│ ⏱ 120min  📌 Admin  ↻ Pendiente │
└──────────────────────────────┘
    (Red left border = service)
```

#### Bottom Sheet Modal
```
      ▰▰▰▰▰▰▰  ← Drag handle
      ✕         ← Close button
Reunión
─────────────────────────────
Cliente: Juan García
Fecha: 2026-04-25
Hora: 10:00 AM
Estado: Confirmada
─────────────────────────────
┌───────────────────────────┐
│     Cancelar Solicitud    │  ← Full width buttons
│     Reagendar             │
│     Aprobar (if pending)  │
└───────────────────────────┘
        ↑ slides up from bottom
```

---

## Testing Workflows

### Workflow 1: Tap Event Card
1. **Desktop/Tablet**: Click on event pill
2. **Mobile**: Tap event card in the list
3. **Expected**: Bottom sheet slides up with full details
4. **Try**: Click "Reagendar" button
5. **Expected**: Modal slides down, reschedule form appears

### Workflow 2: Reschedule Event
#### On Desktop:
1. Click and drag an event to another day
2. **Expected**: Ghost element follows cursor
3. Drop on new day
4. **Expected**: Reschedule modal opens with suggested date pre-filled
5. Select new time/duration
6. Click "Guardar Cambios"
7. **Expected**: Modal closes, calendar refreshes, event moved

#### On Mobile:
1. Tap event card to open modal
2. Tap "Reagendar"
3. Fill in new date, time, duration
4. Tap "Guardar Cambios"
5. **Expected**: Modal closes, events list refreshes instantly

### Workflow 3: Navigate by Date
1. On mobile, tap different days in week strip
2. **Expected**: Events list updates instantly
3. **Visual**: Selected day gets red border
4. Swipe horizontally to see more days

### Workflow 4: Switch Device Sizes
1. Start on desktop view (1024px)
2. Slowly resize browser window down to 768px
3. **Expected**: Calendar re-renders with week strip
4. Events pills disappear, event cards appear
5. Modals change from centered to bottom-sheet
6. Resize back up to 1024px
7. **Expected**: Reverts to grid + centered modals

---

## Visual Checklist: Mobile View

### Calendar Section ✅
- [ ] 7-column grid is HIDDEN
- [ ] Week strip visible with 7 day pills
- [ ] Day letters (D, L, M, X, J, V, S) visible
- [ ] Date numbers visible
- [ ] Current week only (no other months visible)
- [ ] Today highlighted with red circle
- [ ] Selected day has red border/background

### Events Section ✅
- [ ] Full-width event cards (not pills)
- [ ] Each card has time on top
- [ ] Each card has full event title visible
- [ ] Each card has colored left border (blue/red/gray)
- [ ] Metadata visible (duration, admin, status)
- [ ] Smooth fade-in animation on load
- [ ] "Sin eventos" message if day empty

### Interactions ✅
- [ ] Tap event card → bottom sheet slides up
- [ ] Drag handle bar visible at modal top
- [ ] Close button (X) visible in header
- [ ] Modal buttons stack vertically
- [ ] Buttons full-width (no gaps on sides)
- [ ] Modal scrollable if content overflows
- [ ] Tap backdrop → modal closes
- [ ] Status badges show with emoji (⏳ ✓ ↻ ✗)

### Animations ✅
- [ ] Week strip scrolls smoothly
- [ ] Event cards fade in smoothly
- [ ] Modal slides up (not just appears)
- [ ] Modal has slight spring bounce effect
- [ ] Backdrop fades with blur
- [ ] No jumpy or glitchy animations

### Spacing & Typography ✅
- [ ] Text is readable (not too small)
- [ ] Cards have adequate padding
- [ ] No text overflow on edges
- [ ] Buttons are large enough to tap (44px+ height)
- [ ] Input fields are large (44px+ height)
- [ ] 16px input font (prevents iOS zoom)

---

## Debugging: Browser Console

### Check State
```javascript
// In browser console:
console.log(state.agendaSelectedDate)  // Should be selected date
console.log(state.allRequests)         // Should have requests
console.log(state.personalEvents)      // Should have events
```

### Check Mobile Detection
```javascript
// Verify mobile view detected:
console.log(window.innerWidth < 768)   // Should be true on mobile
```

### Check Classes
```javascript
// Verify modal-open class is added when modal opens:
console.log(document.body.classList.contains('modal-open'))
```

### Check Styles Applied
```javascript
// Check if mobile styles are active:
const style = window.getComputedStyle(document.querySelector('.agenda-month-body'))
console.log(style.display)  // Should be 'none' on mobile
```

---

## Common Issues & Fixes

### Issue: Calendar still shows 7-column grid on mobile
**Fix**: 
- Clear browser cache (Ctrl+Shift+Delete)
- Hard reload (Ctrl+Shift+R)
- Check DevTools that width < 768px
- Verify CSS file was updated (check Network tab for theme-enhancements.css)

### Issue: Week strip not scrollable
**Fix**:
- Check overflow-x: auto is applied
- Verify touch-scrolling enabled for iOS (-webkit-overflow-scrolling: touch)
- Try swiping (not clicking arrows)

### Issue: Modal doesn't slide from bottom
**Fix**:
- Check CSS animation is applied (slideUpSpring)
- Verify modal-overlay has align-items: flex-end
- Clear cache and reload
- Check z-index isn't too high

### Issue: Events list not updating when clicking day
**Fix**:
- Open browser console, check for errors
- Verify paintMobileEventsList() is being called
- Check state.allRequests has data
- Try clicking different days

### Issue: Buttons overflow on mobile
**Fix**:
- Check modal-footer has flex-direction: column
- Verify buttons have width: auto or flex: 1
- Check CSS media query is active (<768px)

---

## Performance Checklist

### Desktop Performance
- [ ] No lag when clicking days
- [ ] Modals appear instantly
- [ ] Drag-drop smooth and responsive
- [ ] Page doesn't freeze when loading events
- [ ] Scrolling is smooth (60fps)

### Mobile Performance
- [ ] Week strip scrolls without jank
- [ ] Switching days is instant (no delay)
- [ ] Modal appears quickly
- [ ] Form inputs responsive (no lag on typing)
- [ ] No memory leaks (DevTools → Performance → Memory)

---

## Testing Devices Recommended

- **Desktop**: Windows 1920x1080 (Chrome, Edge)
- **Tablet**: iPad (1024x1366) or Android tablet
- **Mobile**: iPhone 12/13 (390x844), iPhone XS (375x812), Pixel 5 (393x851), Samsung S21 (360x800)

---

## Sign-Off Checklist

When testing is complete, verify:
- [ ] Mobile calendar displays correctly on actual devices
- [ ] Events can be tapped and modal appears
- [ ] Drag-drop works on desktop with visual feedback
- [ ] Modals close properly
- [ ] Firebase operations complete (no errors)
- [ ] Scrolling is smooth (no jank)
- [ ] No console errors
- [ ] Touch targets are adequate (not too small)
- [ ] Animations feel natural (not too fast/slow)
- [ ] Desktop view unchanged (backward compatible)

---

**Ready to test!** 🚀

If you encounter any issues, check the browser console (F12) for error messages and compare with the checklist above.
