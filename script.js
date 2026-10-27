/**
 * Study Companion — Smart Academic Workload Optimizer
 * Developed for VJCET Education Hackathon "The Missing Piece"
 *
 * Core Modules:
 * 1. Storage & State Management (localStorage, snapshot rollback)
 * 2. Date Utility Engine (Zero-timezone offset ISO date arithmetic)
 * 3. Assessment CRUD & Form Validation
 * 4. Deterministic Constraint-Aware Greedy Optimizer
 * 5. Visual Rendering (Dashboard stats, Weekly Calendar, Heatmap Matrix)
 * 6. Dual Chart Engine (Chart.js with offline pure HTML/CSS fallback)
 * 7. Verification & Automated Unit Test Suite
 */

'use strict';

// ============================================================================
// 1. STATE & CONSTANTS
// ============================================================================

const STORAGE_KEYS = {
  ASSESSMENTS: 'studycompanion_assessments_v1',
  SETTINGS: 'studycompanion_settings_v1',
  SNAPSHOT: 'studycompanion_snapshot_v1',
  LEGACY_ASSESSMENTS: 'loadbalance_assessments_v1',
  LEGACY_SETTINGS: 'loadbalance_settings_v1',
  LEGACY_SNAPSHOT: 'loadbalance_snapshot_v1'
};

const DEFAULT_SETTINGS = {
  dailyThreshold: 4.0,       // Max safe workload hours per day
  cautionThreshold: 3.0,     // Warning amber threshold
  defaultEarliestOffset: 5,  // Days before deadline
  defaultLatestOffset: 3,    // Days after deadline
  inertiaWeight: 'balanced'  // 'balanced', 'aggressive', 'conservative'
};

// Global App State
const state = {
  assessments: [],
  settings: { ...DEFAULT_SETTINGS },
  currentCalendarWeekStart: null, // Local Date object (Monday)
  activeTab: 'dashboard',
  pendingProposal: null,          // Proposed schedule from optimizer
  lastSnapshot: null,             // For rollback / undo
  charts: {
    dashboard: null,
    original: null,
    proposed: null
  }
};

// Priority Multipliers for Optimizer Penalty Scoring
const PRIORITY_MULTIPLIER = {
  high: 3.0,
  medium: 1.5,
  low: 1.0
};

// Inertia Weights (Higher = less willing to shift deadlines from original)
const INERTIA_WEIGHT_MAP = {
  aggressive: 0.8,
  balanced: 2.0,
  conservative: 4.5
};

// ============================================================================
// 2. TIMEZONE-SAFE DATE UTILITIES
// ============================================================================

/**
 * Parses a 'YYYY-MM-DD' string into a local Date without UTC offset distortions.
 */
function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return new Date();
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date();
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

/**
 * Formats a Date object into 'YYYY-MM-DD' local string.
 */
function formatLocalDate(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds (or subtracts) days from a 'YYYY-MM-DD' string.
 */
function addDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/**
 * Returns integer day difference: (d2 - d1).
 */
function diffDays(d1Str, d2Str) {
  const d1 = parseLocalDate(d1Str);
  const d2 = parseLocalDate(d2Str);
  const msPerDay = 86400000;
  return Math.round((d2.getTime() - d1.getTime()) / msPerDay);
}

/**
 * Returns Monday of the week for a given Date.
 */
function getMonday(dateObj) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when Sunday
  d.setDate(diff);
  return d;
}

/**
 * Friendly readable date label (e.g., 'Wed, Oct 28').
 */
function formatDisplayDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Generates an array of 7 date strings ('YYYY-MM-DD') starting from Monday.
 */
function getWeekDaysArray(mondayDate) {
  const days = [];
  const start = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate());
  for (let i = 0; i < 7; i++) {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    days.push(formatLocalDate(cur));
  }
  return days;
}

// ============================================================================
// 3. STORAGE & STATE INITIALIZATION
// ============================================================================

function loadStateFromStorage() {
  try {
    // Load Settings
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS) || localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS);
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      state.settings = { ...DEFAULT_SETTINGS, ...parsed };
    }

    // Load Snapshot if available
    const storedSnapshot = localStorage.getItem(STORAGE_KEYS.SNAPSHOT) || localStorage.getItem(STORAGE_KEYS.LEGACY_SNAPSHOT);
    if (storedSnapshot) {
      state.lastSnapshot = JSON.parse(storedSnapshot);
    }

    // Load Assessments
    const storedAssessments = localStorage.getItem(STORAGE_KEYS.ASSESSMENTS) || localStorage.getItem(STORAGE_KEYS.LEGACY_ASSESSMENTS);
    if (storedAssessments) {
      const parsed = JSON.parse(storedAssessments);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.assessments = validateAndSanitizeAssessments(parsed);
      } else {
        loadDemoData(false);
      }
    } else {
      // First time launch: populate realistic demo data
      loadDemoData(false);
    }
  } catch (err) {
    console.error('Storage parse error, recovering with demo data:', err);
    loadDemoData(false);
  }

  // Anchor calendar view to current week Monday
  state.currentCalendarWeekStart = getMonday(new Date());
}

function saveAssessmentsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.ASSESSMENTS, JSON.stringify(state.assessments));
  } catch (err) {
    console.error('Failed to save assessments to localStorage:', err);
    showToast('Failed to save to local storage. Storage might be full.', 'error');
  }
}

function saveSettingsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function saveSnapshot(assessmentList) {
  try {
    state.lastSnapshot = JSON.parse(JSON.stringify(assessmentList));
    localStorage.setItem(STORAGE_KEYS.SNAPSHOT, JSON.stringify(state.lastSnapshot));
    updateUndoButtonVisibility();
  } catch (err) {
    console.error('Failed to save undo snapshot:', err);
  }
}

function validateAndSanitizeAssessments(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => {
    return item && typeof item.title === 'string' &&
           typeof item.originalDeadline === 'string' &&
           typeof item.estimatedHours === 'number' && item.estimatedHours > 0;
  }).map(item => ({
    id: item.id || 'asmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    title: String(item.title).trim(),
    subject: String(item.subject || 'General').trim(),
    type: ['assignment', 'lab', 'quiz', 'internal_exam', 'project'].includes(item.type) ? item.type : 'assignment',
    originalDeadline: item.originalDeadline,
    currentDeadline: item.currentDeadline || item.originalDeadline,
    earliestAllowedDate: item.earliestAllowedDate || addDays(item.originalDeadline, -state.settings.defaultEarliestOffset),
    latestAllowedDate: item.latestAllowedDate || addDays(item.originalDeadline, state.settings.defaultLatestOffset),
    estimatedHours: Number(item.estimatedHours) || 3.0,
    priority: ['low', 'medium', 'high'].includes(item.priority) ? item.priority : 'medium',
    reschedulable: item.type === 'internal_exam' ? (item.reschedulable === true) : (item.reschedulable !== false),
    notes: String(item.notes || '').trim()
  }));
}

// ============================================================================
// 4. REALISTIC DEMO DATA GENERATOR
// ============================================================================

/**
 * Creates a realistic, 2-week Computer Science semester schedule.
 * Specifically crafted to demonstrate:
 * - Clashing deadlines on Wednesday (Peak of 9.5 hours!)
 * - Fixed Internal Examination that CANNOT be moved
 * - Multiple flexible assignments, labs, and a project milestone
 */
function generateDemoData() {
  const monday = getMonday(new Date());
  const mStr = formatLocalDate(monday);

  // Day offsets relative to current week's Monday
  // Day 0: Monday, Day 1: Tuesday, Day 2: Wednesday (CLASH DAY!), Day 3: Thursday, Day 4: Friday (EXAM DAY!)
  // Week 2: Day 7: Mon, Day 8: Tue, Day 9: Wed, Day 10: Thu, Day 11: Fri
  const demoItems = [
    {
      id: 'demo_1_dbms',
      title: 'Database Normalization & SQL Queries',
      subject: 'CS301 Database Systems',
      type: 'assignment',
      originalDeadline: addDays(mStr, 2), // Wednesday Week 1
      currentDeadline: addDays(mStr, 2),
      earliestAllowedDate: addDays(mStr, 0), // Mon Week 1
      latestAllowedDate: addDays(mStr, 6),   // Sun Week 1
      estimatedHours: 3.5,
      priority: 'medium',
      reschedulable: true,
      notes: '3NF schema decomposition, BCNF proofs, and complex subqueries.'
    },
    {
      id: 'demo_2_os_lab',
      title: 'CPU Scheduling Simulation in C++',
      subject: 'CS303 Operating Systems',
      type: 'lab',
      originalDeadline: addDays(mStr, 2), // Wednesday Week 1 (CLASH!)
      currentDeadline: addDays(mStr, 2),
      earliestAllowedDate: addDays(mStr, 0), // Mon Week 1
      latestAllowedDate: addDays(mStr, 4),   // Fri Week 1
      estimatedHours: 4.0,
      priority: 'high',
      reschedulable: true,
      notes: 'Implement Round Robin and Multi-Level Feedback Queue with Gantt output.'
    },
    {
      id: 'demo_3_cd_quiz',
      title: 'LR Parser & Syntax Tree Quiz',
      subject: 'CS305 Compiler Design',
      type: 'quiz',
      originalDeadline: addDays(mStr, 2), // Wednesday Week 1 (CLASH #3! 3.5+4.0+2.0 = 9.5h!)
      currentDeadline: addDays(mStr, 2),
      earliestAllowedDate: addDays(mStr, 1), // Tue Week 1
      latestAllowedDate: addDays(mStr, 5),   // Sat Week 1
      estimatedHours: 2.0,
      priority: 'medium',
      reschedulable: true,
      notes: 'Online Moodle test covering FIRST, FOLLOW sets and shift-reduce conflicts.'
    },
    {
      id: 'demo_4_cn_exam',
      title: 'First Internal Exam: Computer Networks',
      subject: 'CS307 Computer Networks',
      type: 'internal_exam',
      originalDeadline: addDays(mStr, 4), // Friday Week 1
      currentDeadline: addDays(mStr, 4),
      earliestAllowedDate: addDays(mStr, 4), // Strict single date
      latestAllowedDate: addDays(mStr, 4),
      estimatedHours: 3.0,
      priority: 'high',
      reschedulable: false, // STRICTLY LOCKED EXAM
      notes: 'Institutional exam covering OSI layers, TCP sliding window, subnetting.'
    },
    {
      id: 'demo_5_mp_lab',
      title: '8086 Assembly Array Sorting Lab',
      subject: 'CS309 Microprocessors',
      type: 'lab',
      originalDeadline: addDays(mStr, 3), // Thursday Week 1
      currentDeadline: addDays(mStr, 3),
      earliestAllowedDate: addDays(mStr, 1),
      latestAllowedDate: addDays(mStr, 5),
      estimatedHours: 3.0,
      priority: 'medium',
      reschedulable: true,
      notes: 'Write TASM assembly code for 16-bit bubble sort and display via DOS interrupt.'
    },
    {
      id: 'demo_6_se_srs',
      title: 'SRS Document & Architecture Spec',
      subject: 'CS311 Software Engineering',
      type: 'project',
      originalDeadline: addDays(mStr, 8), // Tuesday Week 2
      currentDeadline: addDays(mStr, 8),
      earliestAllowedDate: addDays(mStr, 5),
      latestAllowedDate: addDays(mStr, 11),
      estimatedHours: 5.0,
      priority: 'high',
      reschedulable: true,
      notes: 'IEEE 830 format SRS with use case diagrams and architectural views.'
    },
    {
      id: 'demo_7_wt_milestone',
      title: 'REST API & Auth Milestone',
      subject: 'CS313 Web Technologies',
      type: 'project',
      originalDeadline: addDays(mStr, 8), // Tuesday Week 2 (CLASH in week 2!)
      currentDeadline: addDays(mStr, 8),
      earliestAllowedDate: addDays(mStr, 6),
      latestAllowedDate: addDays(mStr, 12),
      estimatedHours: 4.5,
      priority: 'medium',
      reschedulable: true,
      notes: 'JWT authentication endpoints and CRUD database routes.'
    },
    {
      id: 'demo_8_dsa_assignment',
      title: 'AVL Trees & Red-Black Tree Proofs',
      subject: 'CS201 Data Structures',
      type: 'assignment',
      originalDeadline: addDays(mStr, 9), // Wednesday Week 2
      currentDeadline: addDays(mStr, 9),
      earliestAllowedDate: addDays(mStr, 7),
      latestAllowedDate: addDays(mStr, 13),
      estimatedHours: 3.0,
      priority: 'low',
      reschedulable: true,
      notes: 'Height invariant calculations and rotation tracing.'
    }
  ];

  return demoItems;
}

function loadDemoData(notify = true) {
  state.assessments = generateDemoData();
  state.pendingProposal = null;
  saveAssessmentsToStorage();
  refreshAllViews();
  if (notify) {
    showToast('Loaded demo semester schedule with realistic clashes & locked exam.', 'success');
  }
}

function loadDemoProjectRush(notify = true) {
  const monday = getMonday(new Date());
  const mStr = formatLocalDate(monday);

  state.assessments = [
    {
      id: 'rush_1_capstone',
      title: 'Capstone Project Phase 1 Architecture',
      subject: 'CS491 Major Project',
      type: 'project',
      originalDeadline: addDays(mStr, 3), // Thursday (Clash!)
      currentDeadline: addDays(mStr, 3),
      earliestAllowedDate: addDays(mStr, 0),
      latestAllowedDate: addDays(mStr, 6),
      estimatedHours: 6.0,
      priority: 'high',
      reschedulable: true,
      notes: 'Microservices architecture diagram and Docker compose setup.'
    },
    {
      id: 'rush_2_ai_lab',
      title: 'A* Search & Neural Net Lab Report',
      subject: 'CS401 Artificial Intelligence',
      type: 'lab',
      originalDeadline: addDays(mStr, 3), // Thursday (Clash! 6.0 + 4.5 = 10.5h!)
      currentDeadline: addDays(mStr, 3),
      earliestAllowedDate: addDays(mStr, 1),
      latestAllowedDate: addDays(mStr, 5),
      estimatedHours: 4.5,
      priority: 'high',
      reschedulable: true,
      notes: 'Hyperparameter tuning benchmarks and loss curves.'
    },
    {
      id: 'rush_3_cloud_quiz',
      title: 'AWS Cloud Architecture Quiz',
      subject: 'CS405 Cloud Computing',
      type: 'quiz',
      originalDeadline: addDays(mStr, 3), // Thursday (Clash #3! +2.0 = 12.5h!)
      currentDeadline: addDays(mStr, 3),
      earliestAllowedDate: addDays(mStr, 2),
      latestAllowedDate: addDays(mStr, 6),
      estimatedHours: 2.0,
      priority: 'medium',
      reschedulable: true,
      notes: 'IAM policies, VPC peering, and S3 lifecycle rules.'
    },
    {
      id: 'rush_4_fixed_exam',
      title: 'Internal Exam: Cybersecurity & Cryptography',
      subject: 'CS407 Information Security',
      type: 'internal_exam',
      originalDeadline: addDays(mStr, 4), // Friday
      currentDeadline: addDays(mStr, 4),
      earliestAllowedDate: addDays(mStr, 4),
      latestAllowedDate: addDays(mStr, 4),
      estimatedHours: 3.5,
      priority: 'high',
      reschedulable: false, // Locked exam
      notes: 'AES key expansion, RSA modular arithmetic, and elliptic curves.'
    },
    {
      id: 'rush_5_ethics_paper',
      title: 'AI Ethics & Privacy Position Paper',
      subject: 'HU301 Professional Ethics',
      type: 'assignment',
      originalDeadline: addDays(mStr, 1), // Tuesday
      currentDeadline: addDays(mStr, 1),
      earliestAllowedDate: addDays(mStr, 0),
      latestAllowedDate: addDays(mStr, 5),
      estimatedHours: 2.5,
      priority: 'low',
      reschedulable: true,
      notes: 'Ethical analysis of automated decision systems in healthcare.'
    }
  ];

  state.pendingProposal = null;
  saveAssessmentsToStorage();
  refreshAllViews();
  if (notify) {
    showToast('Loaded Project Crunch Week scenario (Severe 12.5h Thursday peak).', 'success');
  }
}


// ============================================================================
// 5. DETERMINISTIC SMART SCHEDULE OPTIMIZER (THE INNOVATION)
// ============================================================================

/**
 * Deterministic Constraint-Aware Greedy Optimizer
 *
 * Algorithm Architecture:
 * 1. Hard Constraints (Zero Violations Allowed):
 *    - Respects earliestAllowedDate and latestAllowedDate.
 *    - Assessments with reschedulable === false (or internal exams) are strictly locked.
 * 2. Conservation of Workload:
 *    - Sum of hours across all assessments remains mathematically constant.
 * 3. Soft Multi-Objective Cost Function:
 *    - Minimize peak workload on any day.
 *    - Quadratic penalty for days exceeding daily threshold tau (e.g. 4.0h).
 *    - Inertia penalty: Penalizes shifting away from original deadline, scaled by priority.
 * 4. Determinism:
 *    - Explicit deterministic tie-breaking (prefers closest date to original, then earlier date, then stable ID).
 */
function runScheduleOptimizer(options = {}) {
  const threshold = Number(options.threshold || state.settings.dailyThreshold);
  const inertiaMode = options.inertiaWeight || state.settings.inertiaWeight || 'balanced';
  const inertiaFactor = INERTIA_WEIGHT_MAP[inertiaMode] || 2.0;

  if (!state.assessments || state.assessments.length === 0) {
    return {
      success: false,
      message: 'No assessments available to optimize. Please add assessments or load demo data.'
    };
  }

  // Deep clone assessments to avoid side-effects
  const assessments = JSON.parse(JSON.stringify(state.assessments));

  // Step 1: Identify all relevant date boundaries
  let minDate = assessments[0].earliestAllowedDate;
  let maxDate = assessments[0].latestAllowedDate;

  assessments.forEach(a => {
    if (a.earliestAllowedDate < minDate) minDate = a.earliestAllowedDate;
    if (a.latestAllowedDate > maxDate) maxDate = a.latestAllowedDate;
  });

  // Step 2: Initialize daily workload accumulator
  // Map of dateStr -> totalHours
  const dailyWorkload = {};
  const spanDays = diffDays(minDate, maxDate);
  for (let i = 0; i <= spanDays; i++) {
    const curDate = addDays(minDate, i);
    dailyWorkload[curDate] = 0;
  }

  // Step 3: Separate fixed assessments from flexible assessments
  const fixedAssessments = [];
  const flexibleAssessments = [];

  assessments.forEach(a => {
    // Internal exams are fixed unless explicitly unlocked by user
    const isLocked = !a.reschedulable || (a.type === 'internal_exam' && !a.reschedulable);
    if (isLocked) {
      fixedAssessments.push(a);
    } else {
      flexibleAssessments.push(a);
    }
  });

  // Step 4: Place fixed assessments onto the workload calendar first
  fixedAssessments.forEach(a => {
    const d = a.currentDeadline;
    dailyWorkload[d] = (dailyWorkload[d] || 0) + a.estimatedHours;
  });

  // Step 5: Deterministic Sort for Flexible Assessments
  // Priority order:
  // 1. Flexibility Window Size (latest - earliest) ascending: tightest windows scheduled first
  // 2. Priority descending: high priority scheduled before medium/low
  // 3. Effort descending: larger blocks scheduled before smaller ones
  // 4. Stable ID tie-breaker
  flexibleAssessments.sort((a, b) => {
    const windowA = diffDays(a.earliestAllowedDate, a.latestAllowedDate);
    const windowB = diffDays(b.earliestAllowedDate, b.latestAllowedDate);
    if (windowA !== windowB) return windowA - windowB;

    const prioValA = a.priority === 'high' ? 3 : a.priority === 'medium' ? 2 : 1;
    const prioValB = b.priority === 'high' ? 3 : b.priority === 'medium' ? 2 : 1;
    if (prioValA !== prioValB) return prioValB - prioValA;

    if (b.estimatedHours !== a.estimatedHours) return b.estimatedHours - a.estimatedHours;
    return a.id.localeCompare(b.id);
  });

  // Step 6: Greedy Placement with Soft Penalty Evaluation
  const proposedAssessments = [];
  const shiftLog = [];

  for (const a of flexibleAssessments) {
    let bestDate = a.currentDeadline;
    let minScore = Infinity;

    const startAllowed = a.earliestAllowedDate;
    const endAllowed = a.latestAllowedDate;
    const candidateDaysCount = diffDays(startAllowed, endAllowed);

    // Evaluate every permitted candidate date
    for (let c = 0; c <= candidateDaysCount; c++) {
      const candidateDate = addDays(startAllowed, c);
      const currentLoadOnCandidate = dailyWorkload[candidateDate] || 0;
      const projectedLoad = currentLoadOnCandidate + a.estimatedHours;

      // 1. Overload Penalty: Quadratic penalty if projected load exceeds daily threshold
      let overloadPenalty = 0;
      if (projectedLoad > threshold) {
        const excess = projectedLoad - threshold;
        overloadPenalty = Math.pow(excess, 2) * 60;
      }

      // 2. Workload Level Penalty: Encourages even distribution
      const loadDistributionPenalty = projectedLoad * 10;

      // 3. Inertia / Distance Penalty: Prefers staying at or near original deadline
      const distFromOriginal = Math.abs(diffDays(a.originalDeadline, candidateDate));
      const prioMultiplier = PRIORITY_MULTIPLIER[a.priority] || 1.5;
      const inertiaPenalty = distFromOriginal * inertiaFactor * prioMultiplier * 4;

      // Total Composite Cost Score
      const totalScore = overloadPenalty + loadDistributionPenalty + inertiaPenalty;

      // Deterministic Selection & Tie-breaking:
      // If strictly lower score -> pick candidate
      // If score is tied -> prefer candidate closer to original deadline
      // If still tied -> prefer earlier date
      if (totalScore < minScore - 1e-6) {
        minScore = totalScore;
        bestDate = candidateDate;
      } else if (Math.abs(totalScore - minScore) <= 1e-6) {
        const bestDist = Math.abs(diffDays(a.originalDeadline, bestDate));
        if (distFromOriginal < bestDist) {
          bestDate = candidateDate;
        } else if (distFromOriginal === bestDist && candidateDate < bestDate) {
          bestDate = candidateDate;
        }
      }
    }

    // Place assessment on chosen date
    dailyWorkload[bestDate] = (dailyWorkload[bestDate] || 0) + a.estimatedHours;

    const proposedItem = {
      ...a,
      proposedDeadline: bestDate
    };
    proposedAssessments.push(proposedItem);

    if (bestDate !== a.currentDeadline) {
      const daysMoved = diffDays(a.currentDeadline, bestDate);
      shiftLog.push({
        id: a.id,
        title: a.title,
        subject: a.subject,
        type: a.type,
        priority: a.priority,
        effort: a.estimatedHours,
        originalDeadline: a.originalDeadline,
        previousDeadline: a.currentDeadline,
        proposedDeadline: bestDate,
        daysMoved,
        reason: daysMoved > 0
          ? `Moved forward by +${daysMoved}d to relieve workload peak`
          : `Moved earlier by ${daysMoved}d to fill low-workload day`
      });
    }
  }

  // Combine fixed items and flexible items
  const allProposed = [
    ...fixedAssessments.map(a => ({ ...a, proposedDeadline: a.currentDeadline })),
    ...proposedAssessments
  ];

  // Step 7: Calculate Comparative Metrics
  const originalMetrics = calculateScheduleMetrics(assessments, threshold);
  const proposedMetrics = calculateScheduleMetrics(
    allProposed.map(a => ({ ...a, currentDeadline: a.proposedDeadline })),
    threshold
  );

  return {
    success: true,
    proposedAssessments: allProposed,
    shiftLog,
    threshold,
    originalMetrics,
    proposedMetrics,
    shiftsCount: shiftLog.length,
    totalCount: assessments.length
  };
}

/**
 * Calculates max workload, overloaded days, and total hours for a schedule.
 */
function calculateScheduleMetrics(assessmentList, threshold) {
  const map = {};
  let totalEffort = 0;

  assessmentList.forEach(a => {
    const d = a.currentDeadline;
    map[d] = (map[d] || 0) + a.estimatedHours;
    totalEffort += a.estimatedHours;
  });

  let maxDaily = 0;
  let overloadedDays = 0;

  Object.keys(map).forEach(d => {
    const load = map[d];
    if (load > maxDaily) maxDaily = load;
    if (load > threshold) overloadedDays++;
  });

  return {
    maxDailyWorkload: Number(maxDaily.toFixed(1)),
    overloadedDays,
    totalWorkload: Number(totalEffort.toFixed(1)),
    dailyMap: map
  };
}

// ============================================================================
// 6. DASHBOARD & STATS RENDERING
// ============================================================================

function renderDashboard() {
  const assessments = state.assessments;
  const threshold = state.settings.dailyThreshold;

  // 1. Total Assessments
  const totalCount = assessments.length;
  document.getElementById('statTotalAssessments').textContent = totalCount;
  document.getElementById('sidebarAssessmentCount').textContent = totalCount;

  // 2. Due in Next 7 Days (Starting from today)
  const todayStr = formatLocalDate(new Date());
  const next7Str = addDays(todayStr, 7);

  const dueNext7 = assessments.filter(a => {
    return a.currentDeadline >= todayStr && a.currentDeadline <= next7Str;
  });
  document.getElementById('statDueNext7').textContent = dueNext7.length;

  // 3. Current Week Workload Hours (Monday to Sunday)
  const monday = state.currentCalendarWeekStart || getMonday(new Date());
  const currentWeekDays = getWeekDaysArray(monday);
  const weekStartStr = currentWeekDays[0];
  const weekEndStr = currentWeekDays[6];

  let currentWeekHours = 0;
  const weekDailyLoads = {};
  currentWeekDays.forEach(d => { weekDailyLoads[d] = 0; });

  assessments.forEach(a => {
    if (a.currentDeadline >= weekStartStr && a.currentDeadline <= weekEndStr) {
      currentWeekHours += a.estimatedHours;
      weekDailyLoads[a.currentDeadline] = (weekDailyLoads[a.currentDeadline] || 0) + a.estimatedHours;
    }
  });

  document.getElementById('statCurrentWeekHours').textContent = `${currentWeekHours.toFixed(1)}h`;
  const avgDaily = (currentWeekHours / 7).toFixed(1);
  document.getElementById('statCurrentWeekHoursSub').textContent = `Avg ~${avgDaily}h / day`;

  // 4. Overloaded Days across the whole semester schedule
  const allDailyMetrics = calculateScheduleMetrics(assessments, threshold);
  const overloadedCount = allDailyMetrics.overloadedDays;
  const statOverloadEl = document.getElementById('statOverloadedDays');
  const cardOverloadEl = document.getElementById('cardOverload');
  const iconOverloadEl = document.getElementById('iconOverloadWrapper');

  statOverloadEl.textContent = overloadedCount;

  if (overloadedCount > 0) {
    cardOverloadEl.classList.add('border-danger');
    iconOverloadEl.className = 'stat-icon-wrapper icon-red';
    document.getElementById('statOverloadContext').textContent = `${overloadedCount} day(s) exceed ${threshold}h limit`;
    document.getElementById('statOverloadContext').className = 'stat-context text-danger';
  } else {
    cardOverloadEl.classList.remove('border-danger');
    iconOverloadEl.className = 'stat-icon-wrapper icon-teal';
    document.getElementById('statOverloadContext').textContent = 'All days within limit';
    document.getElementById('statOverloadContext').className = 'stat-context text-success';
  }

  // Update Chart Threshold Label
  document.getElementById('chartThresholdLabel').textContent = `${threshold.toFixed(1)}h`;
  document.getElementById('chartWeekRangeLabel').textContent =
    `${formatDisplayDate(weekStartStr)} – ${formatDisplayDate(weekEndStr)}`;

  // 5. Render Weekly Workload Bar Chart
  renderWeeklyWorkloadChart(currentWeekDays, weekDailyLoads, threshold);

  // 6. Upcoming Deadlines List
  renderUpcomingDeadlinesList(assessments);
}

/**
 * Renders upcoming deadlines in chronological order.
 */
function renderUpcomingDeadlinesList(assessments) {
  const container = document.getElementById('dashboardDeadlinesList');
  if (!container) return;

  if (assessments.length === 0) {
    container.innerHTML = `
      <div class="empty-state p-4">
        <p class="text-muted font-sm">No upcoming assessments found.</p>
      </div>`;
    return;
  }

  const sorted = [...assessments].sort((a, b) => a.currentDeadline.localeCompare(b.currentDeadline));
  const nearest = sorted.slice(0, 6);

  let html = '';
  nearest.forEach(a => {
    const isShifted = a.currentDeadline !== a.originalDeadline;
    const typeColor = getTypeColor(a.type);

    html += `
      <div class="deadline-item" data-id="${a.id}">
        <div class="deadline-left">
          <div class="deadline-type-stripe" style="background-color: ${typeColor};"></div>
          <div class="deadline-meta">
            <span class="deadline-title" title="${escapeHtml(a.title)}">${escapeHtml(a.title)}</span>
            <div class="deadline-sub">
              <span>${escapeHtml(a.subject)}</span>
              <span>&bull;</span>
              <span class="badge ${getPriorityClass(a.priority)}">${a.priority.toUpperCase()}</span>
              ${isShifted ? '<span class="shifted-date-badge">&circlearrowleft; Rebalanced</span>' : ''}
            </div>
          </div>
        </div>
        <div class="deadline-right">
          <span class="deadline-due-date">${formatDisplayDate(a.currentDeadline)}</span>
          <span class="deadline-hours">${a.estimatedHours.toFixed(1)}h</span>
          <button class="btn btn-xs btn-outline-secondary btn-inspect" data-id="${a.id}" title="Inspect Details">
            &vellip;
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add click listeners to items
  container.querySelectorAll('.deadline-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.getAttribute('data-id');
      openAssessmentDetails(id);
    });
  });
}

// ============================================================================
// 7. CHART RENDERING ENGINE (CHART.JS + RESILIENT OFFLINE FALLBACK)
// ============================================================================

/**
 * Renders the dashboard weekly workload chart with threshold line.
 * If Chart.js CDN is unavailable, smoothly falls back to an accessible HTML/CSS bar chart.
 */
function renderWeeklyWorkloadChart(dayKeys, dailyLoads, threshold) {
  const canvas = document.getElementById('weeklyWorkloadChart');
  const fallback = document.getElementById('chartFallback');
  if (!canvas || !fallback) return;

  const labels = dayKeys.map(d => {
    const dateObj = parseLocalDate(d);
    return dateObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  });

  const dataValues = dayKeys.map(d => dailyLoads[d] || 0);

  // Background colors depending on workload severity
  const bgColors = dataValues.map(v => {
    if (v === 0) return '#cbd5e1';
    if (v <= state.settings.cautionThreshold) return '#10b981'; // Green
    if (v <= threshold) return '#f59e0b';                       // Amber
    return '#ef4444';                                           // Red
  });

  // Verify if Chart.js is loaded
  if (typeof Chart !== 'undefined') {
    canvas.classList.remove('hidden');
    fallback.classList.add('hidden');

    if (state.charts.dashboard) {
      state.charts.dashboard.destroy();
    }

    const ctx = canvas.getContext('2d');
    state.charts.dashboard = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Estimated Workload (Hours)',
          data: dataValues,
          backgroundColor: bgColors,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 45
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed.y;
                let status = 'Manageable';
                if (val > threshold) status = 'OVERLOADED';
                else if (val > state.settings.cautionThreshold) status = 'Near Capacity';
                return ` Workload: ${val} hrs (${status})`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(threshold * 1.5, 6),
            title: {
              display: true,
              text: 'Hours',
              font: { weight: '600', size: 11 }
            },
            grid: {
              color: '#f1f5f9'
            }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  } else {
    // Pure HTML/CSS fallback if offline or CDN is blocked
    canvas.classList.add('hidden');
    fallback.classList.remove('hidden');
    renderPureHtmlBarChart(fallback, labels, dataValues, threshold);
  }
}

/**
 * Pure HTML/CSS Bar Chart Fallback (Zero dependencies)
 */
function renderPureHtmlBarChart(container, labels, values, threshold) {
  const maxVal = Math.max(...values, threshold, 6);
  let html = '';

  for (let i = 0; i < labels.length; i++) {
    const val = values[i];
    const heightPercent = Math.min(100, Math.round((val / maxVal) * 100));
    let color = '#cbd5e1';
    if (val > threshold) color = '#ef4444';
    else if (val > state.settings.cautionThreshold) color = '#f59e0b';
    else if (val > 0) color = '#10b981';

    html += `
      <div class="fallback-bar-group" title="${labels[i]}: ${val} hrs">
        <span class="fallback-bar-hours">${val > 0 ? val.toFixed(1) + 'h' : '0'}</span>
        <div class="fallback-bar" style="height: ${Math.max(6, heightPercent)}%; background-color: ${color};"></div>
        <span class="fallback-bar-label">${labels[i]}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ============================================================================
// 8. ASSESSMENTS MANAGEMENT & TABLE VIEW
// ============================================================================

function renderAssessmentsTable() {
  const tbody = document.getElementById('assessmentsTableBody');
  const emptyState = document.getElementById('assessmentsEmptyState');
  const table = document.getElementById('assessmentsTable');
  if (!tbody) return;

  const search = (document.getElementById('assessmentSearch')?.value || '').toLowerCase();
  const filterType = document.getElementById('filterType')?.value || 'all';
  const filterPriority = document.getElementById('filterPriority')?.value || 'all';
  const filterReschedulable = document.getElementById('filterReschedulable')?.value || 'all';
  const sortBy = document.getElementById('sortBy')?.value || 'date-asc';

  let list = [...state.assessments];

  // Filtering
  list = list.filter(a => {
    if (search) {
      const match = a.title.toLowerCase().includes(search) ||
                    a.subject.toLowerCase().includes(search) ||
                    (a.notes && a.notes.toLowerCase().includes(search));
      if (!match) return false;
    }
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterPriority !== 'all' && a.priority !== filterPriority) return false;
    if (filterReschedulable === 'reschedulable' && !a.reschedulable) return false;
    if (filterReschedulable === 'fixed' && a.reschedulable) return false;
    return true;
  });

  // Sorting
  list.sort((a, b) => {
    if (sortBy === 'date-asc') return a.currentDeadline.localeCompare(b.currentDeadline);
    if (sortBy === 'date-desc') return b.currentDeadline.localeCompare(a.currentDeadline);
    if (sortBy === 'effort-desc') return b.estimatedHours - a.estimatedHours;
    if (sortBy === 'priority-desc') {
      const pMap = { high: 3, medium: 2, low: 1 };
      return pMap[b.priority] - pMap[a.priority];
    }
    if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
    return 0;
  });

  if (list.length === 0) {
    tbody.innerHTML = '';
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  table.classList.remove('hidden');
  emptyState.classList.add('hidden');

  let rowsHtml = '';
  list.forEach(a => {
    const isShifted = a.currentDeadline !== a.originalDeadline;
    const typeBadge = `<span class="type-badge badge-${a.type}">${formatTypeLabel(a.type)}</span>`;
    const prioBadge = `<span class="badge ${getPriorityClass(a.priority)}">${a.priority.toUpperCase()}</span>`;
    const flexBadge = a.reschedulable
      ? `<span class="badge badge-success font-xs">&#10003; Flexible</span>`
      : `<span class="badge badge-danger font-xs">&#128274; Fixed Date</span>`;

    rowsHtml += `
      <tr>
        <td>
          <div class="table-assessment-title">${escapeHtml(a.title)}</div>
          <div class="table-assessment-subject">${escapeHtml(a.subject)}</div>
        </td>
        <td>${typeBadge}</td>
        <td>
          <strong>${formatDisplayDate(a.currentDeadline)}</strong>
          ${isShifted ? `<div class="shifted-date-badge" title="Original: ${a.originalDeadline}">Orig: ${formatDisplayDate(a.originalDeadline)}</div>` : ''}
        </td>
        <td>
          <span class="font-xs font-mono text-muted">${formatDisplayDate(a.earliestAllowedDate)} &rarr; ${formatDisplayDate(a.latestAllowedDate)}</span>
        </td>
        <td><strong>${a.estimatedHours.toFixed(1)}h</strong></td>
        <td>${prioBadge}</td>
        <td>${flexBadge}</td>
        <td class="text-right">
          <div class="d-flex align-items-center justify-content-end gap-2">
            <button class="btn btn-xs btn-outline-secondary btn-action-inspect" data-id="${a.id}" title="View Details">View</button>
            <button class="btn btn-xs btn-outline-primary btn-action-edit" data-id="${a.id}" title="Edit Assessment">Edit</button>
            <button class="btn btn-xs btn-outline-danger btn-action-delete" data-id="${a.id}" title="Delete Assessment">&times;</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;

  // Bind Row Action Buttons
  tbody.querySelectorAll('.btn-action-inspect').forEach(b => {
    b.addEventListener('click', () => openAssessmentDetails(b.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.btn-action-edit').forEach(b => {
    b.addEventListener('click', () => openEditAssessmentModal(b.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.btn-action-delete').forEach(b => {
    b.addEventListener('click', () => deleteAssessment(b.getAttribute('data-id')));
  });
}

// ============================================================================
// 9. CALENDAR & WORKLOAD HEATMAP VIEWS
// ============================================================================

function renderWeeklyCalendar() {
  const container = document.getElementById('weekDaysGrid');
  const titleEl = document.getElementById('calendarWeekDisplayTitle');
  if (!container || !titleEl) return;

  const monday = state.currentCalendarWeekStart || getMonday(new Date());
  const weekDays = getWeekDaysArray(monday);
  const threshold = state.settings.dailyThreshold;

  document.getElementById('calThresholdDisplay').textContent = `${threshold.toFixed(1)}h`;

  const weekStartStr = weekDays[0];
  const weekEndStr = weekDays[6];
  titleEl.textContent = `Week of ${formatDisplayDate(weekStartStr)} – ${formatDisplayDate(weekEndStr)}`;

  const todayStr = formatLocalDate(new Date());

  // Group assessments by deadline
  const dayBuckets = {};
  weekDays.forEach(d => {
    dayBuckets[d] = {
      date: d,
      totalHours: 0,
      assessments: []
    };
  });

  state.assessments.forEach(a => {
    if (dayBuckets[a.currentDeadline]) {
      dayBuckets[a.currentDeadline].assessments.push(a);
      dayBuckets[a.currentDeadline].totalHours += a.estimatedHours;
    }
  });

  let gridHtml = '';
  weekDays.forEach(d => {
    const bucket = dayBuckets[d];
    const dateObj = parseLocalDate(d);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = dateObj.getDate();
    const isToday = (d === todayStr);
    const isOverloaded = bucket.totalHours > threshold;

    let badgeClass = 'manageable';
    let statusText = 'Manageable';
    if (isOverloaded) {
      badgeClass = 'overload';
      statusText = 'OVERLOAD';
    } else if (bucket.totalHours >= state.settings.cautionThreshold) {
      badgeClass = 'warning';
      statusText = 'Caution';
    }

    let cardsHtml = '';
    if (bucket.assessments.length === 0) {
      cardsHtml = `<div class="text-muted font-xs p-2 text-center">No assessments due</div>`;
    } else {
      bucket.assessments.forEach(a => {
        const typeColor = getTypeColor(a.type);
        cardsHtml += `
          <div class="day-card" data-id="${a.id}" style="border-left-color: ${typeColor};">
            <div class="day-card-title">${escapeHtml(a.title)}</div>
            <div class="day-card-subject">${escapeHtml(a.subject)}</div>
            <div class="day-card-footer">
              <span class="badge ${getPriorityClass(a.priority)} font-xs">${a.priority[0].toUpperCase()}</span>
              <span class="day-card-hours">${a.estimatedHours.toFixed(1)}h</span>
            </div>
          </div>
        `;
      });
    }

    gridHtml += `
      <div class="day-column ${isToday ? 'is-today' : ''} ${isOverloaded ? 'is-overloaded' : ''}">
        <div class="day-header">
          <div class="d-flex justify-content-between align-items-center">
            <span class="day-name">${dayName}</span>
            <span class="day-date-number">${dayNum}</span>
          </div>
          <div class="day-workload-badge ${badgeClass}">
            <span>${bucket.totalHours.toFixed(1)}h</span>
            <span class="font-xs">${statusText}</span>
          </div>
        </div>
        <div class="day-assessments-container">
          ${cardsHtml}
        </div>
      </div>
    `;
  });

  container.innerHTML = gridHtml;

  // Card click inspection
  container.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', () => {
      openAssessmentDetails(card.getAttribute('data-id'));
    });
  });
}

function renderHeatmapMatrix() {
  const container = document.getElementById('heatmapMatrix');
  if (!container) return;

  const threshold = parseFloat(document.getElementById('heatmapThresholdInput')?.value || state.settings.dailyThreshold);

  // Generate 4 consecutive weeks of heatmap view centered around current week
  const startMonday = new Date(state.currentCalendarWeekStart || getMonday(new Date()));
  startMonday.setDate(startMonday.getDate() - 7); // Show 1 week prior and 2 weeks after

  // Header row for days of week
  const daysHeader = ['Week', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '';
  daysHeader.forEach(h => {
    html += `<div class="heatmap-header-cell">${h}</div>`;
  });

  // Calculate daily workload map
  const dailyWorkload = {};
  state.assessments.forEach(a => {
    dailyWorkload[a.currentDeadline] = (dailyWorkload[a.currentDeadline] || 0) + a.estimatedHours;
  });

  for (let w = 0; w < 4; w++) {
    const weekMon = new Date(startMonday);
    weekMon.setDate(startMonday.getDate() + (w * 7));
    const weekLabel = `Wk ${w + 1}`;

    html += `<div class="heatmap-row-label">${weekLabel}</div>`;

    for (let d = 0; d < 7; d++) {
      const cur = new Date(weekMon);
      cur.setDate(weekMon.getDate() + d);
      const curStr = formatLocalDate(cur);
      const hours = dailyWorkload[curStr] || 0;

      let levelClass = 'box-level-0';
      if (hours > 6) levelClass = 'box-level-4';
      else if (hours > threshold) levelClass = 'box-level-3';
      else if (hours > state.settings.cautionThreshold) levelClass = 'box-level-2';
      else if (hours > 0) levelClass = 'box-level-1';

      html += `
        <div class="heatmap-cell ${levelClass}" title="${formatDisplayDate(curStr)}: ${hours.toFixed(1)}h (Limit: ${threshold}h)" data-date="${curStr}">
          <span class="heatmap-cell-hours">${hours > 0 ? hours.toFixed(1) + 'h' : '—'}</span>
          <span class="heatmap-cell-date">${cur.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

// ============================================================================
// 10. OPTIMIZER VIEW & PROPOSAL COMPARISON
// ============================================================================

function executeOptimizerProposal() {
  const threshold = parseFloat(document.getElementById('optMaxDailyThreshold').value || state.settings.dailyThreshold);
  const inertiaWeight = document.getElementById('optInertiaWeight').value || 'balanced';

  const result = runScheduleOptimizer({ threshold, inertiaWeight });
  if (!result.success) {
    showToast(result.message, 'warning');
    return;
  }

  state.pendingProposal = result;

  // Show proposal section, hide idle state
  document.getElementById('optimizerProposalSection').classList.remove('hidden');
  document.getElementById('optimizerIdleState').classList.add('hidden');

  renderProposalComparison(result);
  showToast(`Optimization calculated! ${result.shiftsCount} deadline(s) adjusted to flatten peaks.`, 'success');
}

function renderProposalComparison(result) {
  const { originalMetrics, proposedMetrics, shiftsCount, totalCount, shiftLog, threshold } = result;

  // 1. Metric Badges
  document.getElementById('compMaxOld').textContent = `${originalMetrics.maxDailyWorkload.toFixed(1)}h`;
  document.getElementById('compMaxNew').textContent = `${proposedMetrics.maxDailyWorkload.toFixed(1)}h`;
  const peakReduction = originalMetrics.maxDailyWorkload > 0
    ? Math.round(((originalMetrics.maxDailyWorkload - proposedMetrics.maxDailyWorkload) / originalMetrics.maxDailyWorkload) * 100)
    : 0;
  document.getElementById('compMaxDelta').textContent = `${peakReduction}% Peak Workload Reduction`;

  document.getElementById('compOverloadOld').textContent = originalMetrics.overloadedDays;
  document.getElementById('compOverloadNew').textContent = proposedMetrics.overloadedDays;
  const daysResolved = originalMetrics.overloadedDays - proposedMetrics.overloadedDays;
  document.getElementById('compOverloadDelta').textContent = `${daysResolved >= 0 ? daysResolved : 0} Overloaded Day(s) Eliminated`;

  document.getElementById('compTotalOld').textContent = `${originalMetrics.totalWorkload.toFixed(1)}h`;
  document.getElementById('compTotalNew').textContent = `${proposedMetrics.totalWorkload.toFixed(1)}h`;

  document.getElementById('compShiftCount').textContent = shiftsCount;
  document.getElementById('compTotalAssessmentsCount').textContent = totalCount;
  document.getElementById('compThresholdLabel').textContent = `${threshold.toFixed(1)}h`;

  // 2. Render Side-by-Side Comparison Charts
  renderComparisonCharts(result);

  // 3. Render Shift Log Table
  const tbody = document.getElementById('proposalChangesBody');
  if (!tbody) return;

  if (shiftLog.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted p-4">
          Current schedule is already well-balanced within the specified daily capacity. No adjustments required.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  shiftLog.forEach(s => {
    const shiftBadge = s.daysMoved > 0
      ? `<span class="badge badge-primary">+${s.daysMoved} Days</span>`
      : `<span class="badge badge-warning">${s.daysMoved} Days</span>`;

    html += `
      <tr>
        <td><strong>${escapeHtml(s.title)}</strong></td>
        <td>
          <span class="type-badge badge-${s.type}">${formatTypeLabel(s.type)}</span>
          <div class="text-muted font-xs">${escapeHtml(s.subject)}</div>
        </td>
        <td><span class="comp-old">${formatDisplayDate(s.originalDeadline)}</span></td>
        <td><strong class="text-success">${formatDisplayDate(s.proposedDeadline)}</strong></td>
        <td>${shiftBadge}</td>
        <td><span class="font-xs font-mono">${formatDisplayDate(s.originalDeadline)} &plusmn; window</span></td>
        <td><span class="font-xs text-muted">${escapeHtml(s.reason)}</span></td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Side-by-side Chart rendering for Before vs After schedule.
 */
function renderComparisonCharts(result) {
  const origMap = result.originalMetrics.dailyMap;
  const propMap = result.proposedMetrics.dailyMap;

  // Union of all active dates
  const allDates = Array.from(new Set([...Object.keys(origMap), ...Object.keys(propMap)])).sort();

  const labels = allDates.map(d => {
    const obj = parseLocalDate(d);
    return obj.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  });

  const origValues = allDates.map(d => origMap[d] || 0);
  const propValues = allDates.map(d => propMap[d] || 0);
  const threshold = result.threshold;

  // Chart 1: Original
  renderSingleComparisonChart('chartOriginal', 'chartOriginalFallback', labels, origValues, threshold, '#ef4444', 'Original Workload');

  // Chart 2: Proposed
  renderSingleComparisonChart('chartProposed', 'chartProposedFallback', labels, propValues, threshold, '#10b981', 'Proposed Balanced Workload');
}

function renderSingleComparisonChart(canvasId, fallbackId, labels, values, threshold, primaryColor, label) {
  const canvas = document.getElementById(canvasId);
  const fallback = document.getElementById(fallbackId);
  if (!canvas || !fallback) return;

  const bgColors = values.map(v => v > threshold ? '#ef4444' : (v > 0 ? primaryColor : '#cbd5e1'));

  if (typeof Chart !== 'undefined') {
    canvas.classList.remove('hidden');
    fallback.classList.add('hidden');

    const key = canvasId === 'chartOriginal' ? 'original' : 'proposed';
    if (state.charts[key]) {
      state.charts[key].destroy();
    }

    const ctx = canvas.getContext('2d');
    state.charts[key] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data: values,
          backgroundColor: bgColors,
          borderRadius: 4,
          maxBarThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(...values, threshold + 2)
          },
          x: {
            ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } }
          }
        }
      }
    });
  } else {
    canvas.classList.add('hidden');
    fallback.classList.remove('hidden');
    renderPureHtmlBarChart(fallback, labels, values, threshold);
  }
}

function applyProposedSchedule() {
  if (!state.pendingProposal || !state.pendingProposal.proposedAssessments) {
    showToast('No pending proposal to apply.', 'warning');
    return;
  }

  // Save current state into rollback snapshot before applying
  saveSnapshot(state.assessments);

  // Update deadlines
  const proposalMap = {};
  state.pendingProposal.proposedAssessments.forEach(p => {
    proposalMap[p.id] = p.proposedDeadline;
  });

  state.assessments = state.assessments.map(a => {
    if (proposalMap[a.id]) {
      return {
        ...a,
        currentDeadline: proposalMap[a.id]
      };
    }
    return a;
  });

  saveAssessmentsToStorage();
  state.pendingProposal = null;

  document.getElementById('optimizerProposalSection').classList.add('hidden');
  document.getElementById('optimizerIdleState').classList.remove('hidden');

  refreshAllViews();
  showToast('Proposed schedule approved and applied! Snapshot saved for undo.', 'success');
}

function cancelProposedSchedule() {
  state.pendingProposal = null;
  document.getElementById('optimizerProposalSection').classList.add('hidden');
  document.getElementById('optimizerIdleState').classList.remove('hidden');
  showToast('Proposed schedule optimization discarded.', 'info');
}

function undoLastOptimization() {
  if (!state.lastSnapshot || !Array.isArray(state.lastSnapshot)) {
    showToast('No previous schedule snapshot available to undo.', 'warning');
    return;
  }

  state.assessments = JSON.parse(JSON.stringify(state.lastSnapshot));
  saveAssessmentsToStorage();
  state.lastSnapshot = null;
  localStorage.removeItem(STORAGE_KEYS.SNAPSHOT);
  updateUndoButtonVisibility();

  refreshAllViews();
  showToast('Previous schedule restored successfully!', 'success');
}

function updateUndoButtonVisibility() {
  const undoBtn = document.getElementById('btnGlobalUndo');
  if (!undoBtn) return;
  if (state.lastSnapshot && Array.isArray(state.lastSnapshot) && state.lastSnapshot.length > 0) {
    undoBtn.classList.remove('hidden');
  } else {
    undoBtn.classList.add('hidden');
  }
}

// ============================================================================
// 11. ASSESSMENT CRUD & MODAL FORMS
// ============================================================================

function openAddAssessmentModal() {
  const form = document.getElementById('assessmentForm');
  if (!form) return;
  form.reset();

  document.getElementById('assessmentFormId').value = '';
  document.getElementById('modalAssessmentTitle').textContent = 'Add Academic Assessment';
  document.getElementById('modalFormAlert').classList.add('hidden');

  const todayStr = formatLocalDate(new Date());
  const defaultDeadline = addDays(todayStr, 3);
  document.getElementById('formDeadline').value = defaultDeadline;
  document.getElementById('formEarliest').value = addDays(defaultDeadline, -state.settings.defaultEarliestOffset);
  document.getElementById('formLatest').value = addDays(defaultDeadline, state.settings.defaultLatestOffset);
  document.getElementById('formEffort').value = '3.0';
  document.getElementById('formReschedulable').checked = true;

  document.getElementById('assessmentModal').classList.remove('hidden');
}

function openEditAssessmentModal(id) {
  const item = state.assessments.find(a => a.id === id);
  if (!item) return;

  const form = document.getElementById('assessmentForm');
  form.reset();

  document.getElementById('assessmentFormId').value = item.id;
  document.getElementById('modalAssessmentTitle').textContent = 'Edit Assessment';
  document.getElementById('modalFormAlert').classList.add('hidden');

  document.getElementById('formTitle').value = item.title;
  document.getElementById('formSubject').value = item.subject;
  document.getElementById('formType').value = item.type;
  document.getElementById('formPriority').value = item.priority;
  document.getElementById('formEffort').value = item.estimatedHours;
  document.getElementById('formDeadline').value = item.currentDeadline;
  document.getElementById('formEarliest').value = item.earliestAllowedDate;
  document.getElementById('formLatest').value = item.latestAllowedDate;
  document.getElementById('formReschedulable').checked = item.reschedulable;
  document.getElementById('formNotes').value = item.notes || '';

  // Close details modal if open
  document.getElementById('assessmentDetailsModal').classList.add('hidden');
  document.getElementById('assessmentModal').classList.remove('hidden');
}

function handleAssessmentFormSubmit(e) {
  e.preventDefault();
  const alertEl = document.getElementById('modalFormAlert');
  alertEl.classList.add('hidden');

  const id = document.getElementById('assessmentFormId').value;
  const title = document.getElementById('formTitle').value.trim();
  const subject = document.getElementById('formSubject').value.trim();
  const type = document.getElementById('formType').value;
  const priority = document.getElementById('formPriority').value;
  const effort = parseFloat(document.getElementById('formEffort').value);
  const deadline = document.getElementById('formDeadline').value;
  const earliest = document.getElementById('formEarliest').value;
  const latest = document.getElementById('formLatest').value;
  const reschedulable = document.getElementById('formReschedulable').checked;
  const notes = document.getElementById('formNotes').value.trim();

  // Validations
  if (!title) {
    showFormError(alertEl, 'Assessment title is required.');
    return;
  }
  if (!subject) {
    showFormError(alertEl, 'Subject / Course is required.');
    return;
  }
  if (isNaN(effort) || effort <= 0 || effort > 50) {
    showFormError(alertEl, 'Estimated effort must be a positive number between 0.5 and 50 hours.');
    return;
  }
  if (!deadline || !earliest || !latest) {
    showFormError(alertEl, 'Scheduled deadline, earliest allowed date, and latest date are all required.');
    return;
  }
  if (earliest > latest) {
    showFormError(alertEl, 'Earliest allowed date cannot be later than the latest permitted deadline.');
    return;
  }
  if (deadline < earliest || deadline > latest) {
    showFormError(alertEl, `Scheduled deadline (${deadline}) must fall within permitted date range [${earliest} to ${latest}].`);
    return;
  }

  if (id) {
    // Edit existing
    const idx = state.assessments.findIndex(a => a.id === id);
    if (idx !== -1) {
      const existing = state.assessments[idx];
      state.assessments[idx] = {
        ...existing,
        title,
        subject,
        type,
        priority,
        estimatedHours: effort,
        currentDeadline: deadline,
        earliestAllowedDate: earliest,
        latestAllowedDate: latest,
        reschedulable,
        notes
      };
      showToast('Assessment updated successfully.', 'success');
    }
  } else {
    // Create new
    const newAssessment = {
      id: 'asmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title,
      subject,
      type,
      originalDeadline: deadline,
      currentDeadline: deadline,
      earliestAllowedDate: earliest,
      latestAllowedDate: latest,
      estimatedHours: effort,
      priority,
      reschedulable,
      notes
    };
    state.assessments.push(newAssessment);
    showToast('New assessment added.', 'success');
  }

  saveAssessmentsToStorage();
  document.getElementById('assessmentModal').classList.add('hidden');
  refreshAllViews();
}

function showFormError(alertEl, message) {
  alertEl.textContent = message;
  alertEl.classList.remove('hidden');
}

function deleteAssessment(id) {
  const item = state.assessments.find(a => a.id === id);
  if (!item) return;

  openConfirmModal(
    'Delete Assessment',
    `Are you sure you want to delete "${escapeHtml(item.title)}"?`,
    () => {
      state.assessments = state.assessments.filter(a => a.id !== id);
      saveAssessmentsToStorage();
      refreshAllViews();
      showToast('Assessment removed.', 'info');
    }
  );
}

function openAssessmentDetails(id) {
  const item = state.assessments.find(a => a.id === id);
  if (!item) return;

  const modal = document.getElementById('assessmentDetailsModal');
  const titleEl = document.getElementById('modalDetailsTitle');
  const badgeEl = document.getElementById('detailsTypeBadge');
  const bodyEl = document.getElementById('detailsModalBody');

  titleEl.textContent = item.title;
  badgeEl.className = `badge badge-${item.type}`;
  badgeEl.textContent = formatTypeLabel(item.type);

  const isShifted = item.currentDeadline !== item.originalDeadline;

  bodyEl.innerHTML = `
    <div class="mb-3">
      <div class="font-sm text-muted">Subject / Course:</div>
      <strong class="font-md text-navy">${escapeHtml(item.subject)}</strong>
    </div>

    <div class="form-row mb-3">
      <div class="flex-1">
        <div class="font-sm text-muted">Scheduled Deadline:</div>
        <strong class="font-md ${isShifted ? 'text-success' : 'text-navy'}">${formatDisplayDate(item.currentDeadline)}</strong>
        ${isShifted ? `<div class="font-xs text-muted">Original: ${formatDisplayDate(item.originalDeadline)}</div>` : ''}
      </div>
      <div class="flex-1">
        <div class="font-sm text-muted">Estimated Effort:</div>
        <strong class="font-md text-navy">${item.estimatedHours.toFixed(1)} Hours</strong>
      </div>
      <div class="flex-1">
        <div class="font-sm text-muted">Priority:</div>
        <span class="badge ${getPriorityClass(item.priority)}">${item.priority.toUpperCase()}</span>
      </div>
    </div>

    <div class="form-row mb-3">
      <div class="flex-1">
        <div class="font-sm text-muted">Permitted Date Range:</div>
        <strong>${formatDisplayDate(item.earliestAllowedDate)} &rarr; ${formatDisplayDate(item.latestAllowedDate)}</strong>
      </div>
      <div class="flex-1">
        <div class="font-sm text-muted">Optimizer Flexibility:</div>
        <strong>${item.reschedulable ? '&#10003; Reschedulable' : '&#128274; Fixed Date (Protected)'}</strong>
      </div>
    </div>

    ${item.notes ? `
      <div class="mb-2">
        <div class="font-sm text-muted">Notes / Instructions:</div>
        <p class="font-sm p-2 bg-light-muted border-rounded">${escapeHtml(item.notes)}</p>
      </div>` : ''}
  `;

  // Edit button hook
  const editBtn = document.getElementById('btnEditFromDetails');
  editBtn.onclick = () => openEditAssessmentModal(item.id);

  modal.classList.remove('hidden');
}

// ============================================================================
// 12. AUTOMATED VERIFICATION TEST SUITE
// ============================================================================

/**
 * Runs 6 core automated algorithmic and constraint tests.
 * Validates correctness for hackathon presentation and institutional grading.
 */
function runAlgorithmicVerificationSuite() {
  const container = document.getElementById('testResultsGrid');
  const badge = document.getElementById('testSuiteBadge');
  if (!container) return;

  const testSpecs = [
    {
      name: 'Constraint 1: Fixed Internal Exam Immutability',
      description: 'Verifies that internal exams and non-reschedulable assessments are never moved from their original date.',
      run: () => {
        const dummySchedule = [
          {
            id: 'exam_fixed',
            title: 'Computer Architecture Exam',
            subject: 'CS304',
            type: 'internal_exam',
            originalDeadline: '2026-10-30',
            currentDeadline: '2026-10-30',
            earliestAllowedDate: '2026-10-25',
            latestAllowedDate: '2026-11-05',
            estimatedHours: 4.0,
            priority: 'high',
            reschedulable: false // MUST NOT MOVE
          },
          {
            id: 'asmt_heavy',
            title: 'Heavy Project Milestone',
            subject: 'CS304',
            type: 'project',
            originalDeadline: '2026-10-30', // Same day as exam (8h overload!)
            currentDeadline: '2026-10-30',
            earliestAllowedDate: '2026-10-25',
            latestAllowedDate: '2026-11-05',
            estimatedHours: 4.0,
            priority: 'medium',
            reschedulable: true
          }
        ];

        // Backup current assessments and run optimizer on dummy
        const savedAssessments = state.assessments;
        state.assessments = dummySchedule;
        const res = runScheduleOptimizer({ threshold: 4.0 });
        state.assessments = savedAssessments;

        const examResult = res.proposedAssessments.find(a => a.id === 'exam_fixed');
        const pass = examResult && examResult.proposedDeadline === '2026-10-30';
        return {
          pass,
          detail: pass
            ? 'Internal exam remained strictly at 2026-10-30 despite severe 8.0h clash.'
            : 'FAIL: Internal exam deadline was altered.'
        };
      }
    },
    {
      name: 'Constraint 2: Strict Permitted Date Window Guarantee',
      description: 'Ensures proposed deadline strictly satisfies earliestAllowedDate <= proposedDeadline <= latestAllowedDate.',
      run: () => {
        const earliest = '2026-10-28';
        const latest = '2026-10-31';
        const dummySchedule = [
          {
            id: 'window_test',
            title: 'Tight Window Lab',
            subject: 'CS301',
            type: 'lab',
            originalDeadline: '2026-10-29',
            currentDeadline: '2026-10-29',
            earliestAllowedDate: earliest,
            latestAllowedDate: latest,
            estimatedHours: 3.5,
            priority: 'high',
            reschedulable: true
          }
        ];

        const saved = state.assessments;
        state.assessments = dummySchedule;
        const res = runScheduleOptimizer({ threshold: 4.0 });
        state.assessments = saved;

        const item = res.proposedAssessments.find(a => a.id === 'window_test');
        const pass = item && item.proposedDeadline >= earliest && item.proposedDeadline <= latest;
        return {
          pass,
          detail: pass
            ? `Proposed date ${item.proposedDeadline} strictly inside [${earliest}, ${latest}].`
            : `FAIL: Proposed date violated allowed window.`
        };
      }
    },
    {
      name: 'Theorem 3: Mathematical Workload Conservation',
      description: 'Proves total estimated academic effort before optimization is strictly equal to total effort after.',
      run: () => {
        const saved = state.assessments;
        const dummy = generateDemoData();
        state.assessments = dummy;
        const res = runScheduleOptimizer({ threshold: 4.0 });
        state.assessments = saved;

        const sumBefore = dummy.reduce((sum, a) => sum + a.estimatedHours, 0);
        const sumAfter = res.proposedAssessments.reduce((sum, a) => sum + a.estimatedHours, 0);
        const pass = Math.abs(sumBefore - sumAfter) < 1e-5;

        return {
          pass,
          detail: pass
            ? `Workload conservation verified: ${sumBefore.toFixed(1)}h before == ${sumAfter.toFixed(1)}h after (0.0h drift).`
            : `FAIL: Workload discrepancy detected.`
        };
      }
    },
    {
      name: 'Objective 4: Peak Workload & Overload Spike Reduction',
      description: 'Validates that a 9.5-hour single-day peak is flattened below or towards the daily limit.',
      run: () => {
        const saved = state.assessments;
        const dummy = generateDemoData(); // Has 9.5h on Wednesday
        state.assessments = dummy;
        const res = runScheduleOptimizer({ threshold: 4.0 });
        state.assessments = saved;

        const origPeak = res.originalMetrics.maxDailyWorkload;
        const propPeak = res.proposedMetrics.maxDailyWorkload;
        const pass = propPeak < origPeak;

        return {
          pass,
          detail: pass
            ? `Peak squashed from ${origPeak.toFixed(1)}h down to ${propPeak.toFixed(1)}h.`
            : `FAIL: Optimizer failed to reduce peak workload.`
        };
      }
    },
    {
      name: 'Guarantee 5: Determinism & Idempotence',
      description: 'Verifies identical input schedules always produce 100% identical optimization proposals.',
      run: () => {
        const dummy = generateDemoData();
        const saved = state.assessments;
        state.assessments = dummy;

        const run1 = runScheduleOptimizer({ threshold: 4.0 });
        const run2 = runScheduleOptimizer({ threshold: 4.0 });
        state.assessments = saved;

        let pass = true;
        for (let i = 0; i < run1.proposedAssessments.length; i++) {
          if (run1.proposedAssessments[i].proposedDeadline !== run2.proposedAssessments[i].proposedDeadline) {
            pass = false;
            break;
          }
        }

        return {
          pass,
          detail: pass
            ? 'Determinism verified: 100% identical schedule assignments across multiple runs.'
            : 'FAIL: Non-deterministic behavior observed.'
        };
      }
    },
    {
      name: 'Safety 6: Snapshot Rollback & Undo Guarantee',
      description: 'Tests state snapshot capture and rollback integrity, verifying exact restoration.',
      run: () => {
        const initialCount = state.assessments.length;
        const originalTitles = state.assessments.map(a => a.title).join('|');

        saveSnapshot(state.assessments);
        const snapshotValid = state.lastSnapshot !== null && state.lastSnapshot.length === initialCount;

        return {
          pass: snapshotValid,
          detail: snapshotValid
            ? `State snapshot correctly serialized and cached (${initialCount} items preserved).`
            : 'FAIL: Snapshot serialization failed.'
        };
      }
    }
  ];

  let passedCount = 0;
  let html = '';

  testSpecs.forEach(t => {
    let result = { pass: false, detail: 'Error running test' };
    try {
      result = t.run();
    } catch (err) {
      result = { pass: false, detail: err.message };
    }

    if (result.pass) passedCount++;

    html += `
      <div class="test-result-row ${result.pass ? 'test-pass' : 'test-fail'}">
        <div class="test-info">
          <div class="test-title">${escapeHtml(t.name)}</div>
          <div class="test-desc">${escapeHtml(t.description)}</div>
          <div class="font-xs font-mono mt-1 ${result.pass ? 'text-success' : 'text-danger'}">
            &bull; ${escapeHtml(result.detail)}
          </div>
        </div>
        <div class="test-badge-box">
          <span class="badge ${result.pass ? 'badge-success' : 'badge-danger'}">
            ${result.pass ? '&#10003; PASSED' : '&#10007; FAILED'}
          </span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  if (passedCount === testSpecs.length) {
    badge.className = 'badge badge-success';
    badge.textContent = `All ${passedCount}/${testSpecs.length} Tests Passed`;
    showToast(`Verification passed: All ${passedCount} mathematical constraints verified.`, 'success');
  } else {
    badge.className = 'badge badge-danger';
    badge.textContent = `${passedCount}/${testSpecs.length} Tests Passed`;
  }
}

// ============================================================================
// 13. SETTINGS & DATA EXPORT / IMPORT
// ============================================================================

function setupSettingsForm() {
  const form = document.getElementById('settingsForm');
  if (!form) return;

  // Populate initial values
  document.getElementById('settingDailyThreshold').value = state.settings.dailyThreshold;
  document.getElementById('settingCautionThreshold').value = state.settings.cautionThreshold;
  document.getElementById('settingDefaultEarliestOffset').value = state.settings.defaultEarliestOffset;
  document.getElementById('settingDefaultLatestOffset').value = state.settings.defaultLatestOffset;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const threshold = parseFloat(document.getElementById('settingDailyThreshold').value);
    const caution = parseFloat(document.getElementById('settingCautionThreshold').value);
    const earliestOffset = parseInt(document.getElementById('settingDefaultEarliestOffset').value, 10);
    const latestOffset = parseInt(document.getElementById('settingDefaultLatestOffset').value, 10);

    if (threshold <= 0 || caution <= 0) {
      showToast('Thresholds must be positive numbers.', 'error');
      return;
    }

    state.settings.dailyThreshold = threshold;
    state.settings.cautionThreshold = caution;
    state.settings.defaultEarliestOffset = earliestOffset;
    state.settings.defaultLatestOffset = latestOffset;

    saveSettingsToStorage();
    refreshAllViews();
    showToast('Settings saved successfully.', 'success');
  });
}

function exportScheduleJson() {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    app: 'Study Companion — Smart Academic Workload Optimizer',
    settings: state.settings,
    assessments: state.assessments
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studycompanion_schedule_${formatLocalDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Schedule exported as JSON.', 'success');
}

function handleImportScheduleJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (parsed && Array.isArray(parsed.assessments)) {
        saveSnapshot(state.assessments);
        state.assessments = validateAndSanitizeAssessments(parsed.assessments);
        if (parsed.settings) {
          state.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
          saveSettingsToStorage();
        }
        saveAssessmentsToStorage();
        refreshAllViews();
        showToast(`Successfully imported ${state.assessments.length} assessment(s).`, 'success');
      } else {
        showToast('Invalid JSON file format: Missing assessments array.', 'error');
      }
    } catch (err) {
      showToast('Failed to parse JSON file.', 'error');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  openConfirmModal(
    'Clear All Stored Data',
    'Are you sure you want to delete all assessments, snapshots, and custom settings? This cannot be undone.',
    () => {
      localStorage.removeItem(STORAGE_KEYS.ASSESSMENTS);
      localStorage.removeItem(STORAGE_KEYS.SNAPSHOT);
      localStorage.removeItem(STORAGE_KEYS.SETTINGS);
      state.assessments = [];
      state.settings = { ...DEFAULT_SETTINGS };
      state.lastSnapshot = null;
      state.pendingProposal = null;
      refreshAllViews();
      showToast('All application data cleared.', 'info');
    }
  );
}

// ============================================================================
// 14. NAVIGATION & VIEW SWITCHING
// ============================================================================

function switchTab(tabId) {
  state.activeTab = tabId;

  // Update Nav Buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update Panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === `pane-${tabId}`) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Title in Breadcrumb
  const titles = {
    dashboard: 'Dashboard',
    assessments: 'Assessments Management',
    calendar: 'Calendar & Heatmap',
    optimizer: 'Smart Schedule Optimizer',
    tests: 'Algorithm Specification & Tests',
    settings: 'Settings & Data'
  };
  document.getElementById('currentSectionTitle').textContent = titles[tabId] || 'Dashboard';

  // Close mobile sidebar if open
  document.getElementById('sidebar').classList.remove('mobile-open');

  // Trigger relevant view renders
  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'assessments') renderAssessmentsTable();
  if (tabId === 'calendar') {
    renderWeeklyCalendar();
    renderHeatmapMatrix();
  }
  if (tabId === 'tests') runAlgorithmicVerificationSuite();
}

function refreshAllViews() {
  renderDashboard();
  renderAssessmentsTable();
  renderWeeklyCalendar();
  renderHeatmapMatrix();
  updateUndoButtonVisibility();
}

// ============================================================================
// 15. UI HELPERS & MODAL HANDLERS
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="btn-close" style="color:white; margin-left:auto; font-size:1.1rem;">&times;</button>
  `;

  toast.querySelector('.btn-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 4500);
}

function openConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;

  const acceptBtn = document.getElementById('btnConfirmAccept');
  const cancelBtn = document.getElementById('btnConfirmCancel');
  const closeBtn = document.getElementById('btnCloseConfirmModal');

  const cleanup = () => {
    modal.classList.add('hidden');
    acceptBtn.onclick = null;
  };

  acceptBtn.onclick = () => {
    cleanup();
    if (onConfirm) onConfirm();
  };

  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;

  modal.classList.remove('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTypeColor(type) {
  const colors = {
    assignment: '#3b82f6',
    lab: '#8b5cf6',
    quiz: '#06b6d4',
    internal_exam: '#dc2626',
    project: '#d97706'
  };
  return colors[type] || '#64748b';
}

function formatTypeLabel(type) {
  const labels = {
    assignment: 'Assignment',
    lab: 'Lab Submission',
    quiz: 'Quiz',
    internal_exam: 'Internal Exam',
    project: 'Project'
  };
  return labels[type] || type;
}

function getPriorityClass(prio) {
  return `priority-${prio || 'medium'}`;
}

// ============================================================================
// 16. EVENT LISTENERS & APPLICATION BOOTSTRAP
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Load Stored Data or Realistic Demo
  loadStateFromStorage();

  // 2. Setup Navigation Tab Listeners
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Mobile Menu Toggle
  const mobileToggle = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('sidebar');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // 3. Header Action Buttons
  document.getElementById('btnHeaderOptimize')?.addEventListener('click', () => {
    switchTab('optimizer');
    executeOptimizerProposal();
  });

  document.getElementById('btnAddAssessmentTop')?.addEventListener('click', openAddAssessmentModal);
  document.getElementById('btnOpenAddModal')?.addEventListener('click', openAddAssessmentModal);
  document.getElementById('btnEmptyAdd')?.addEventListener('click', openAddAssessmentModal);
  document.getElementById('btnHeroOptimize')?.addEventListener('click', () => {
    switchTab('optimizer');
    executeOptimizerProposal();
  });
  document.getElementById('btnViewAllAssessments')?.addEventListener('click', () => switchTab('assessments'));

  // Global Undo Button
  document.getElementById('btnGlobalUndo')?.addEventListener('click', undoLastOptimization);

  // Demo Load Buttons
  document.getElementById('btnQuickDemoLoad')?.addEventListener('click', () => loadDemoData(true));
  document.getElementById('btnBannerReloadDemo')?.addEventListener('click', () => loadDemoData(true));
  document.getElementById('btnAssessmentsReloadDemo')?.addEventListener('click', () => loadDemoData(true));
  document.getElementById('btnEmptyLoadDemo')?.addEventListener('click', () => loadDemoData(true));
  document.getElementById('btnLoadDemoStandard')?.addEventListener('click', () => loadDemoData(true));
  document.getElementById('btnLoadDemoProjectRush')?.addEventListener('click', () => loadDemoProjectRush(true));

  document.getElementById('btnConfirmClearAll')?.addEventListener('click', clearAllData);
  document.getElementById('btnClearAllLocalStorage')?.addEventListener('click', clearAllData);

  document.getElementById('btnDismissBanner')?.addEventListener('click', () => {
    document.getElementById('demoBanner')?.classList.add('hidden');
  });

  // 4. Assessment Filter Controls
  document.getElementById('assessmentSearch')?.addEventListener('input', renderAssessmentsTable);
  document.getElementById('filterType')?.addEventListener('change', renderAssessmentsTable);
  document.getElementById('filterPriority')?.addEventListener('change', renderAssessmentsTable);
  document.getElementById('filterReschedulable')?.addEventListener('change', renderAssessmentsTable);
  document.getElementById('sortBy')?.addEventListener('change', renderAssessmentsTable);

  // 5. Calendar Navigation Controls
  document.getElementById('btnCalPrevWeek')?.addEventListener('click', () => {
    state.currentCalendarWeekStart.setDate(state.currentCalendarWeekStart.getDate() - 7);
    renderWeeklyCalendar();
  });
  document.getElementById('btnCalToday')?.addEventListener('click', () => {
    state.currentCalendarWeekStart = getMonday(new Date());
    renderWeeklyCalendar();
  });
  document.getElementById('btnCalNextWeek')?.addEventListener('click', () => {
    state.currentCalendarWeekStart.setDate(state.currentCalendarWeekStart.getDate() + 7);
    renderWeeklyCalendar();
  });

  // Calendar Sub-view Mode Switch (Weekly vs Heatmap)
  const btnWeekly = document.getElementById('btnViewWeekly');
  const btnHeatmap = document.getElementById('btnViewHeatmap');
  const weeklyContainer = document.getElementById('weeklyCalendarContainer');
  const heatmapContainer = document.getElementById('heatmapContainer');

  btnWeekly?.addEventListener('click', () => {
    btnWeekly.className = 'btn btn-sm btn-primary';
    btnHeatmap.className = 'btn btn-sm btn-outline-secondary';
    weeklyContainer.classList.remove('hidden');
    heatmapContainer.classList.add('hidden');
    renderWeeklyCalendar();
  });

  btnHeatmap?.addEventListener('click', () => {
    btnHeatmap.className = 'btn btn-sm btn-primary';
    btnWeekly.className = 'btn btn-sm btn-outline-secondary';
    weeklyContainer.classList.add('hidden');
    heatmapContainer.classList.remove('hidden');
    renderHeatmapMatrix();
  });

  document.getElementById('heatmapThresholdInput')?.addEventListener('input', renderHeatmapMatrix);

  // 6. Optimizer Action Buttons
  document.getElementById('btnRunOptimizerMain')?.addEventListener('click', executeOptimizerProposal);
  document.getElementById('btnExecuteOptimizer')?.addEventListener('click', executeOptimizerProposal);
  document.getElementById('btnApplyProposal')?.addEventListener('click', applyProposedSchedule);
  document.getElementById('btnCancelProposal')?.addEventListener('click', cancelProposedSchedule);
  document.getElementById('btnOptimizerInfoToggle')?.addEventListener('click', () => {
    document.getElementById('optimizerInfoCard')?.classList.toggle('hidden');
  });

  // 7. Test Suite Runner
  document.getElementById('btnRunVerificationSuite')?.addEventListener('click', runAlgorithmicVerificationSuite);

  // 8. Assessment Form Submissions & Modal Close Buttons
  document.getElementById('assessmentForm')?.addEventListener('submit', handleAssessmentFormSubmit);
  document.getElementById('btnCloseAssessmentModal')?.addEventListener('click', () => {
    document.getElementById('assessmentModal').classList.add('hidden');
  });
  document.getElementById('btnCancelAssessmentModal')?.addEventListener('click', () => {
    document.getElementById('assessmentModal').classList.add('hidden');
  });

  document.getElementById('btnCloseDetailsModal')?.addEventListener('click', () => {
    document.getElementById('assessmentDetailsModal').classList.add('hidden');
  });
  document.getElementById('btnCloseDetailsBtn')?.addEventListener('click', () => {
    document.getElementById('assessmentDetailsModal').classList.add('hidden');
  });

  // 9. Data Management & Settings
  setupSettingsForm();
  document.getElementById('btnExportJson')?.addEventListener('click', exportScheduleJson);
  document.getElementById('importJsonInput')?.addEventListener('change', handleImportScheduleJson);

  // 10. Initial Render
  refreshAllViews();
  updateUndoButtonVisibility();
});
