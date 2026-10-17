# Dashboard task picker — local correction

The customer selector previously inserted the chosen workspace into the full
summary list, sorted by earliest due date. It could appear far below the picker,
and customer-type chips could exclude it entirely.

Selected customer workspace now appears directly below the picker, independently
of the type filters. The normal list omits that customer to avoid duplicate
editors. The existing Add task / Add note forms and save/history logic are reused.
Pipeline remains click-only. No business data or security changes.

Verification: 39 Pipeline/workspace checks passed, including a real Dashboard
regression selecting a customer outside the active type filter, proving the first
workspace and both editors belong to the chosen customer. Undefined-identifier
lint and diff checks passed. Fictional browser selection/Add task/editor passed.
No live tasks were saved. Not pushed or deployed.
