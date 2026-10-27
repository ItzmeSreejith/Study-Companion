# Study Companion — Smart Academic Workload Optimizer

> **"Balance the deadlines. Improve the learning."**  
> Built for the VJCET Education Hackathon *"The Missing Piece"*

---

## 1. Problem Statement

College students frequently face compressed deadlines where multiple assignments, lab submissions, online quizzes, and internal examinations converge on the same day or week. This causes acute academic workload peaks, unnecessary burnout, reduced submission quality, and inadequate preparation time.

**Study Companion** is an autonomous, client-side academic schedule optimization engine. It visualizes daily workload density, detects deadline bottlenecks, and uses a deterministic greedy optimization algorithm to redistribute flexible assessment deadlines while strictly preserving fixed institutional exam dates.

---

## 2. Technology Stack & Zero-Backend Architecture

- **Core**: HTML5, CSS3, Vanilla JavaScript (ES6+).
- **Visualization**: Chart.js (v4.4 via CDN) with an **offline pure HTML/CSS fallback** bar chart engine if internet or CDN access is unavailable.
- **Persistence**: Browser `localStorage` with JSON serialization, validation, and snapshot undo/rollback support.
- **Date Handling**: Zero-timezone-offset local date arithmetic routines avoiding UTC off-by-one errors.
- **No AI / No Paid APIs / No Cloud Backend**: Fully functional offline and runs in any modern browser.

---

## 3. Quick Start & Setup Instructions

### Option A: Direct Browser Launch
Simply double-click [`index.html`](file:///c:/Users/SreejithS/Desktop/Hackathon/index.html) or right-click & choose **Open with Browser** (Chrome, Edge, Firefox, Safari).

### Option B: Local Development Server (Recommended)
You can serve the directory using Python or Node.js:

```bash
# Using Python 3:
python -m http.server 8080

# Or using npx serve:
npx serve .
```
Then navigate to `http://localhost:8080`.

---

## 4. The Smart Schedule Optimizer Algorithm

### 4.1. Core Principles
The optimizer is a **real, deterministic constraint-satisfaction and greedy load-balancing algorithm**. It never fabricates simulated charts; all chart data reflects actual assessment dates.

### 4.2. Hard Constraints (Zero Violations Allowed)
1. **Permitted Window Bounds**: For each assessment $a$, candidate date $d$ must satisfy:
   $$\text{earliestAllowedDate}(a) \le d \le \text{latestAllowedDate}(a)$$
2. **Fixed Exam Immutability**: Any assessment marked with `reschedulable === false` or `type === 'internal_exam'` is permanently anchored to its institutional deadline.
3. **Conservation of Academic Effort**: Total student effort is conserved:
   $$\sum_{a \in A} \text{effort}(a)_{\text{before}} \equiv \sum_{a \in A} \text{effort}(a)_{\text{after}}$$

### 4.3. Soft Multi-Objective Penalty Function
When placing a flexible assessment $a$ with effort $e$ onto candidate date $d$:
$$\text{ProjectedWorkload}(d) = W(d) + e$$

The candidate evaluation score is computed as:
$$\text{Cost}(d) = \text{OverloadPenalty}(d) + \text{DistributionPenalty}(d) + \text{InertiaPenalty}(d)$$

Where:
- **Overload Penalty**: If $\text{ProjectedWorkload}(d) > \tau$ (daily threshold, default 4.0h):
  $$\text{OverloadPenalty}(d) = (\text{ProjectedWorkload}(d) - \tau)^2 \times 60$$
- **Distribution Penalty**: Prefers dates with lower baseline load:
  $$\text{DistributionPenalty}(d) = \text{ProjectedWorkload}(d) \times 10$$
- **Inertia Penalty**: Penalizes moving away from original deadline, scaled by priority:
  $$\text{InertiaPenalty}(d) = |d - \text{originalDeadline}(a)| \times \text{InertiaWeight} \times \text{PriorityMultiplier} \times 4$$
  *(High Priority = 3.0×, Medium = 1.5×, Low = 1.0×)*

### 4.4. Deterministic Scheduling Order & Tie-Breaking
1. **Sort Order**:
   - Flexibility window $(latest - earliest)$ ascending (most constrained tasks first).
   - Priority descending (high priority before low priority).
   - Estimated effort descending (larger blocks placed first).
   - Lexicographical ID order (deterministic tie-breaker).
2. **Tie-Breaking Rule**:
   If two dates yield identical cost scores, the algorithm selects the date closest to $\text{originalDeadline}(a)$. If still tied, it chooses the chronologically earlier date.

### 4.5. Model Assumption (Version 1)
> **Assumption Note:** For this version, each assessment's effort is treated as workload due on its scheduled deadline date. True study pacing is supported by setting reasonable allowed start and end windows. The system does not claim to track students' private hour-by-hour study habits.

---

## 5. Primary Hackathon Demonstration Journey

1. **Launch App**: Open [`index.html`](file:///c:/Users/SreejithS/Desktop/Hackathon/index.html).
2. **Load Demo Data**: Click **"Load Demo Data"**. Notice Wednesday displays a severe **9.5-hour workload peak** (DBMS Assignment + OS Lab + Compiler Quiz).
3. **Inspect Calendar**: Switch to **"Calendar & Heatmap"** tab to see Wednesday highlighted in red **OVERLOAD**. Friday features the locked **Computer Networks Internal Exam**.
4. **Trigger Optimizer**: Click **"Optimize Schedule"** or **"Run Optimization"**.
5. **Review Comparison Proposal**:
   - Max Daily Peak drops from **9.5h down to 4.0h (-58% reduction)**.
   - Overloaded Days drops from **2 days to 0 days**.
   - Total workload remains **exactly 28.0h conserved**.
   - Check the **Proposed Adjustments Table** explaining each relocation rationale.
6. **Approve & Apply**: Click **"Approve & Apply Schedule"**.
7. **Refresh & Verify Persistence**: Refresh the browser page (`F5`). All balanced dates persist from `localStorage`.
8. **Undo Optimization**: Click the **"Undo Optimization"** button in the topbar to verify instant rollback to the original state.
9. **Run Automated Verification Tests**: Switch to **"Algorithm & Tests"** tab and click **"Execute All Automated Tests"** to prove that all 6 constraint rules pass directly in the browser!

---

## 6. Project File Structure

| File | Description |
|---|---|
| [`index.html`](file:///c:/Users/SreejithS/Desktop/Hackathon/index.html) | Semantic, accessible HTML5 structure with dashboard, calendar, heatmap, optimizer comparison UI, modals, and test suite. |
| [`style.css`](file:///c:/Users/SreejithS/Desktop/Hackathon/style.css) | Custom modern productivity design system, dark navy/teal palette, accessible contrast, responsive breakpoints, and badge styling. |
| [`script.js`](file:///c:/Users/SreejithS/Desktop/Hackathon/script.js) | Full client-side JavaScript engine: state management, timezone-safe date math, greedy optimizer, Chart.js + offline fallback, and test suite. |
| [`README.md`](file:///c:/Users/SreejithS/Desktop/Hackathon/README.md) | Documentation, setup instructions, mathematical proofs, and demo guide. |

---

## 7. Automated Test Suite Highlights

Included directly under the **"Algorithm & Tests"** tab:
- **Test 1**: *Fixed Internal Exam Immutability* (Locks exams even under 8h+ clashes).
- **Test 2**: *Strict Date Window Boundaries* (Never schedules outside permitted range).
- **Test 3**: *Mathematical Workload Conservation* ($\sum \text{Hours}_{\text{before}} \equiv \sum \text{Hours}_{\text{after}}$).
- **Test 4**: *Peak Workload & Overload Reduction* (Proves peak flattening from 9.5h to $\le 4.0\text{h}$).
- **Test 5**: *Determinism & Idempotence* (Runs multiple passes on identical input to confirm identical output).
- **Test 6**: *Snapshot Rollback & Undo Guarantee* (Validates state capture and restoration).

---

Developed with ❤️ for education fairness at **VJCET**.
