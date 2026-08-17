
# Active Tasks

- [x] **Calibrate Current Transformer (CT) Measurements**
    - [x] Analyze discrepancy between displayed (1.6A) and actual (12.5A) current for 5 Ohm/220:1 CT.
    - [x] Update CT Ratio calibration scale to support legacy "xx/100" format.
    - [x] Verify calibration with "12/100" (600:1) CT.
    - [x] Verify calibration with "4/100" (200:1) CT.
    - [x] Implement legacy ratio display in UI menu.

# Backlog

- [ ] **Refine Overload Protection Defaults**
    - [ ] Increase default Overload Current limit (currently 12A) to prevent nuisance tripping with 13A+ loads.
- [ ] **Code Cleanup**
    - [ ] Remove temporary debug prints.
    - [ ] Consolidate lint fixes.
