# Financial Widgets

Small front-end-only financial calculators. Everything runs in the browser, with no build step.

- `index.html`: home page and disclaimer
- `marriage/`: 2026 U.S. federal marriage tax bonus/penalty heatmap. It compares two people filing Single with the same two people filing jointly, counting income tax, FICA, Additional Medicare, and NIIT.
- `health/`: 2026 health plan comparison. Yearly cost (premium + deductible + coinsurance) of up to three plans across medical expense levels, before and after the tax saved through pre-tax premiums, FSA, or HSA.
- `loans/`: pay extra on a car loan or keep the money in a money market fund? Compares the loan APR with the after-tax money market yield, finds the return (IRR) and break-even for a monthly extra payment or a lump sum, and shows interest and time saved. Pulls the latest 13-week Treasury bill rate as a money market proxy. `loans/tests.html` runs the checks in a browser.

**Disclaimer:** I am not a tax or legal professional. This site is vibe-coded, there is no guarantee of accuracy, and it is not tax advice. Use at your own risk.
