# Financial Widgets

Small front-end-only financial calculators. Everything runs in the browser, with no build step.

- `index.html`: home page and disclaimer
- `marriage/`: 2026 U.S. federal marriage tax bonus/penalty heatmap. It compares two people filing Single with the same two people filing jointly, counting income tax, FICA, Additional Medicare, and NIIT.
- `health/`: 2026 health plan comparison. Yearly cost (premium + deductible + coinsurance) of up to three plans across medical expense levels, before and after the tax saved through pre-tax premiums, FSA, or HSA.
- `loans/`: pay extra on a car loan or keep the cash in a money market fund? Compares the two after 2026 federal tax (bracket + NIIT, car loan interest deduction), with a rate comparison, decision map, amount curve, gain waterfall, and gain over time. Pulls the latest 13-week Treasury bill rate as a money market proxy. `loans/tests.html` runs the checks in a browser.

**Disclaimer:** I am not a tax or legal professional. This site is vibe-coded, there is no guarantee of accuracy, and it is not tax advice. Use at your own risk.
