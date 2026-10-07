# Analytics

Every metric shown in the product has a written definition (rendered on the insight card) and a drill-down.

## Phase 0 metric definitions

| Metric                        | Definition                                                         | Source                | Drill-down                             |
| ----------------------------- | ------------------------------------------------------------------ | --------------------- | -------------------------------------- |
| Active students               | Students in scope with status `active`                             | `summarize()`         | `/students`                            |
| Average attendance            | Mean of per-student overall attendance %, threshold 75%            | `summarize()`         | `/students?shortage=1&sort=attendance` |
| Attendance shortage           | Students with overall attendance < 75%                             | `summarize()`         | same                                   |
| High-risk students            | ≥ 2 academic risk factors, or attendance < 65%                     | `evaluateRisk()`      | `/students?risk=high`                  |
| Fees overdue (principal)      | Students with balance past the semester due date                   | `summarize()`         | `/students?fee=overdue`                |
| Average CGPA (HOD)            | Mean CGPA of students with graded semesters                        | `summarize()`         | `/students?sort=cgpa`                  |
| Subject attendance projection | `canMiss = floor(a/t − h)`; `mustAttend = ceil((t·h − a)/(1 − t))` | `projectAttendance()` | Student 360                            |

### Academic risk factors (explainable)

| Factor              | Rule                     |
| ------------------- | ------------------------ |
| Attendance shortage | Overall attendance < 75% |
| Low CGPA            | CGPA < 6.0 (year 2+)     |
| Multiple backlogs   | ≥ 2 active backlogs      |

Fee blockage is excluded from the academic risk index until field-masked finance factors exist (ADR-005).

## Later phases

Phase 3 attendance aggregates, Phase 9 versioned metric library (definition + version + query) with
materialised aggregates, cohort analysis and permission-checked exports.
