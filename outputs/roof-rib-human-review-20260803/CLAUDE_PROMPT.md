# Claude continuation prompt

```text
Repository: C:\Users\rambo\projects\kagariai-props

You are continuing the candidate-only Kagariai roof-rib review. Do not publish, push, enable
production rendering, or mark a Human gate as passed from your own visual judgment.

Read first:
1. outputs/roof-rib-human-review-20260803/README.md
2. outputs/roof-rib-human-review-20260803/REVIEW_SCORECARD.md
3. outputs/roof-rib-human-review-20260803/review-decision.json
4. docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json
5. docs/AAA_ROOF_RIB_RUNTIME_ADMISSION_20260803.md
6. client/img2threejs/roof-rib/runtimeAdmissionCandidate.js
7. client/img2threejs/roof-rib/runtimeAdapter.js

Current verified state:
- candidate-only, production OFF, collision none
- runtimeRenderer technical gate PASS
- Human art and Human competitive readability remain PENDING
- support clearance is 0m after a -0.07m adapter contact correction
- 894/894 tests green
- collision digest 66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29
- renderer evidence SHA-256 3778DEA513E220BA1357FF2D600FE1C1A3F47B9931535F3ED8F3D1877199B1A5

Task:
1. Show the reviewer the five packet images in order.
2. Ask the reviewer to fill or dictate every critical score, blocker, decision, identity and time.
3. Record only the reviewer’s actual answers in REVIEW_SCORECARD.md and review-decision.json.
4. Validate that APPROVE has every critical score >=4 and zero blockers. Otherwise keep gates pending.
5. If REVISE, translate feedback into measurable geometry/material/placement/light changes, use
   img2threejs and TDD, rerender 12m/28m/45m, and issue a new evidence revision and SHA.
6. If both Human sections are genuinely APPROVE, propose the exact admission diff, but do not make
   the production-enabling change unless the user explicitly requests it in that session.
7. Preserve unrelated worktree changes, especially outputs/aaa-material-fpsow-20260803/.

Never:
- treat AI self-review as Human approval;
- replace collision:none with visual-mesh collision;
- weaken the localhost + roofRibReview=1 gate;
- reuse stale screenshots after changing transforms, geometry, materials, lighting or camera;
- expose or write any API key.
```

