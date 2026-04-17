const buildPromoteTiers = () => [
  {
    label: "Tier 1",
    hurdle: 0.08,
    investorShare: 0.9,
    sponsorShare: 0.1,
    isEnabled: true,
    description: "Base split once investor capital and pref are covered."
  },
  {
    label: "Tier 2",
    hurdle: 0.12,
    investorShare: 0.8,
    sponsorShare: 0.2,
    isEnabled: true,
    description: "Promote steps up after a 12% project IRR."
  },
  {
    label: "Tier 3",
    hurdle: 0.18,
    investorShare: 0.7,
    sponsorShare: 0.3,
    isEnabled: true,
    description: "Upper promote tier once the deal clears 18% IRR."
  }
];

export const seedData = {
  asOfDate: "2026-04-09",
  participants: [
    {
      id: "participant-sponsor",
      name: "Njinko Capital",
      category: "sponsor"
    },
    {
      id: "participant-sarah",
      name: "Sarah Thompson",
      category: "investor"
    },
    {
      id: "participant-david",
      name: "David Kim",
      category: "investor"
    },
    {
      id: "participant-john",
      name: "John Rivera",
      category: "contractor"
    },
    {
      id: "participant-ava",
      name: "Ava Patel",
      category: "investor"
    },
    {
      id: "participant-maya",
      name: "Maya Steelworks",
      category: "contractor"
    },
    {
      id: "participant-bluerock",
      name: "Blue Rock Partners",
      category: "investor"
    },
    {
      id: "participant-elite",
      name: "Elite Interiors",
      category: "contractor"
    },
    {
      id: "participant-olivia",
      name: "Olivia Chen",
      category: "investor"
    },
    {
      id: "participant-northgate",
      name: "Northgate Demo",
      category: "contractor"
    }
  ],
  users: [
    {
      id: "user-manager",
      participantId: "participant-sponsor",
      role: "manager",
      name: "Njinko Capital",
      email: "manager@njinko.dev",
      passwordSalt: "5fe7b9b57698d5a97ccfa752bad56c04",
      passwordHash:
        "624f56c4ae4e5a11f9533aa94e7503cad44157d05ee47a2d45e48d992c9d586a2065f235495b7e5fe457c378f0f66d3b97fe01d3543c59d6d39b74aa220bf0aa"
    },
    {
      id: "user-sarah",
      participantId: "participant-sarah",
      role: "investor",
      name: "Sarah Thompson",
      email: "sarah@bluecrest.dev",
      passwordSalt: "7f8d6045ca4aab7af7b7c66a4e2b2e0c",
      passwordHash:
        "4a4621b7af4a27e2c1c78a506d8e17703c6d308d50b7d9655e84be2ce59fa0fa57197a96399b78286fa23a68d5b2fade70e8109ae5a403438980a580dd80f512"
    },
    {
      id: "user-david",
      participantId: "participant-david",
      role: "investor",
      name: "David Kim",
      email: "david@bluecrest.dev",
      passwordSalt: "34273eca7f9f5691e49ff8886014aa72",
      passwordHash:
        "cdd19ccf11a02232da535c46af3fef63d301d92509ae19eb6ab117fc5bb97b3a327ec870e0375e22f4504a7e7c94ae8933cbd246fc49d94c29f5ce37ad809a5d"
    },
    {
      id: "user-john",
      participantId: "participant-john",
      role: "investor",
      name: "John Rivera",
      email: "john@solidset.dev",
      passwordSalt: "867dd3cf176ba6f431b09db655be8280",
      passwordHash:
        "54af81e3b668a3280891a1855c82e581285eae54aeb1954ae4155a059f571ab8089ed5eac551ce9fb4f3f2bb8aaf34255bc637ed0e6470cbce1a0c5cf4e9ce1b"
    }
  ],
  deals: [
    {
      id: "237-ville-development",
      name: "237_Ville Development",
      location: "Charlotte, NC",
      totalEquity: 400000,
      debt: 750000,
      taxExpense: 28000,
      debtInterestRate: 0.1025,
      totalInterestPaid: 68500,
      totalProjectCost: 1150000,
      salePrice: 1650000,
      holdMonths: 18,
      prefRate: 0.08,
      status: "under_construction",
      currentPhase: "Vertical construction",
      fundedOn: "2025-07-15",
      projectedExitOn: "2026-12-20",
      timelineProgress: 62,
      promoteTiers: buildPromoteTiers(),
      timeline: [
        {
          label: "Land close",
          date: "2025-07-15",
          status: "complete"
        },
        {
          label: "Foundation",
          date: "2025-10-10",
          status: "complete"
        },
        {
          label: "Framing",
          date: "2026-04-25",
          status: "in_progress"
        },
        {
          label: "Certificate of occupancy",
          date: "2026-09-30",
          status: "upcoming"
        },
        {
          label: "Target sale",
          date: "2026-12-20",
          status: "upcoming"
        }
      ]
    },
    {
      id: "oak-ridge-townhomes",
      name: "Oak Ridge Townhomes",
      location: "Greensboro, NC",
      totalEquity: 300000,
      debt: 560000,
      taxExpense: 18000,
      debtInterestRate: 0.0975,
      totalInterestPaid: 44200,
      totalProjectCost: 860000,
      salePrice: 1095000,
      holdMonths: 14,
      prefRate: 0.08,
      status: "listed",
      currentPhase: "Broker marketing",
      fundedOn: "2025-05-01",
      projectedExitOn: "2026-06-30",
      timelineProgress: 88,
      promoteTiers: buildPromoteTiers(),
      timeline: [
        {
          label: "Acquisition",
          date: "2025-05-01",
          status: "complete"
        },
        {
          label: "Renovation",
          date: "2025-11-10",
          status: "complete"
        },
        {
          label: "Leasing stabilized",
          date: "2026-02-15",
          status: "complete"
        },
        {
          label: "Listed",
          date: "2026-03-20",
          status: "complete"
        },
        {
          label: "Expected close",
          date: "2026-06-30",
          status: "in_progress"
        }
      ]
    },
    {
      id: "maple-flats-conversion",
      name: "Maple Flats Conversion",
      location: "Durham, NC",
      totalEquity: 250000,
      debt: 430000,
      taxExpense: 22000,
      debtInterestRate: 0.09,
      totalInterestPaid: 31800,
      totalProjectCost: 680000,
      salePrice: 920000,
      holdMonths: 13,
      prefRate: 0.08,
      status: "sold",
      currentPhase: "Closed",
      fundedOn: "2024-03-01",
      actualExitOn: "2025-04-15",
      timelineProgress: 100,
      promoteTiers: buildPromoteTiers(),
      timeline: [
        {
          label: "Acquisition",
          date: "2024-03-01",
          status: "complete"
        },
        {
          label: "Interior conversion",
          date: "2024-08-15",
          status: "complete"
        },
        {
          label: "Lease-up",
          date: "2025-01-10",
          status: "complete"
        },
        {
          label: "Sold",
          date: "2025-04-15",
          status: "complete"
        }
      ]
    }
  ],
  companyResources: [
    {
      id: "resource-bylaw-sample",
      title: "Njinko Company Bylaws",
      dealId: null,
      resourceType: "bylaw_document",
      summary:
        "Reference governance document covering operating procedures, approvals, and investor communications.",
      bodyText: "",
      fileName: "njinko-company-bylaws.txt",
      fileMimeType: "text/plain",
      fileDataUrl:
        "data:text/plain;base64,TmppbmtvIERldmVsb3BtZW50IEdyb3VwIExMQyBCeWxhd3Mgc2FtcGxlIGRvY3VtZW50LgoKVGhpcyBzYW1wbGUgZmlsZSBzaG93cyBob3cgcHVibGlzaGVkIGNvbXBhbnkgZG9jdW1lbnRzIGNhbiBiZSBkb3dubG9hZGVkIGluIHRoZSBpbnZlc3RvciBwb3J0YWwu",
      publishedAt: "2026-03-05T14:00:00.000Z"
    },
    {
      id: "resource-announcement-q2",
      title: "April Portfolio Update",
      dealId: null,
      resourceType: "announcement",
      summary: "Project milestones, loan status, and upcoming investor votes across active deals.",
      bodyText:
        "Framing is underway at 237_Ville Development, Oak Ridge Townhomes remains listed, and no lender defaults are outstanding. Review new voting items in the governance section before the posted close dates.",
      fileName: "",
      fileMimeType: "",
      fileDataUrl: "",
      publishedAt: "2026-04-02T16:30:00.000Z"
    },
    {
      id: "resource-balance-oak-ridge",
      title: "Oak Ridge Townhomes Balance Sheet",
      dealId: "oak-ridge-townhomes",
      resourceType: "project_balance_sheet",
      summary: "Quarter-end balance sheet package for Oak Ridge Townhomes.",
      bodyText: "",
      fileName: "oak-ridge-townhomes-balance-sheet.txt",
      fileMimeType: "text/plain",
      fileDataUrl:
        "data:text/plain;base64,T2FrIFJpZGdlIFRvd25ob21lcyBCYWxhbmNlIFNoZWV0CkFzIG9mIDIwMjYtMDMtMzEKQ2FzaDogJDE0OCwwMDAKQWNjb3VudHMgUmVjZWl2YWJsZTogJDExLDAwMApDb25zdHJ1Y3Rpb24gSW4gUHJvZ3Jlc3M6ICQ2ODIsMDAwCkRlYnQ6ICQ1NjAsMDAwCk1lbWJlciBFcXVpdHk6ICQzMDEsMDAw",
      publishedAt: "2026-04-05T12:00:00.000Z"
    }
  ],
  distributionElections: [
    {
      id: "distribution-maple-sarah",
      dealId: "maple-flats-conversion",
      participantId: "participant-sarah",
      electionMode: "split_percentage",
      reinvestPercent: 0.5,
      reinvestAmount: null,
      rolloverTargetDealId: "237-ville-development",
      notes: "Roll half of the Maple exit into the next Charlotte deal.",
      submittedByUserId: "user-sarah",
      submittedByRole: "investor",
      approvalStatus: "pending",
      approvedReinvestAmount: null,
      approvedCashPayoutAmount: null,
      payoutExpectedOn: null,
      reviewedByUserId: null,
      reviewedAt: null,
      managerOverride: false,
      overrideNotes: null
    },
    {
      id: "distribution-maple-david",
      dealId: "maple-flats-conversion",
      participantId: "participant-david",
      electionMode: "payout_all",
      reinvestPercent: null,
      reinvestAmount: null,
      rolloverTargetDealId: null,
      notes: "Send the full exited balance using saved payout details.",
      submittedByUserId: "user-david",
      submittedByRole: "investor",
      approvalStatus: "approved",
      approvedReinvestAmount: 0,
      approvedCashPayoutAmount: null,
      payoutExpectedOn: "2026-04-10",
      reviewedByUserId: "user-manager",
      reviewedAt: "2026-04-08T15:30:00.000Z",
      managerOverride: false,
      overrideNotes: "Reviewed and approved for payout."
    },
    {
      id: "distribution-maple-olivia",
      dealId: "maple-flats-conversion",
      participantId: "participant-olivia",
      electionMode: "reinvest_all",
      reinvestPercent: null,
      reinvestAmount: null,
      rolloverTargetDealId: "oak-ridge-townhomes",
      notes: "Move the entire exited balance into the next active project.",
      submittedByUserId: "user-manager",
      submittedByRole: "manager",
      approvalStatus: "approved",
      approvedReinvestAmount: null,
      approvedCashPayoutAmount: 0,
      payoutExpectedOn: null,
      reviewedByUserId: "user-manager",
      reviewedAt: "2026-04-09T10:15:00.000Z",
      managerOverride: true,
      overrideNotes: "Backfilled by manager from signed rollover instruction."
    }
  ],
  positions: [
    {
      id: "position-237-sarah",
      dealId: "237-ville-development",
      participantId: "participant-sarah",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 100000,
      distributionsToDate: 0
    },
    {
      id: "position-237-david",
      dealId: "237-ville-development",
      participantId: "participant-david",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 90000,
      distributionsToDate: 0
    },
    {
      id: "position-237-john",
      dealId: "237-ville-development",
      participantId: "participant-john",
      classType: "Class C",
      contributionType: "Deferred compensation",
      contributionAmount: 22500,
      distributionsToDate: 0
    },
    {
      id: "position-237-ava",
      dealId: "237-ville-development",
      participantId: "participant-ava",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 125000,
      distributionsToDate: 0
    },
    {
      id: "position-237-maya",
      dealId: "237-ville-development",
      participantId: "participant-maya",
      classType: "Class C",
      contributionType: "Deferred compensation",
      contributionAmount: 62500,
      distributionsToDate: 0
    },
    {
      id: "position-oak-sarah",
      dealId: "oak-ridge-townhomes",
      participantId: "participant-sarah",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 60000,
      distributionsToDate: 0
    },
    {
      id: "position-oak-david",
      dealId: "oak-ridge-townhomes",
      participantId: "participant-david",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 40000,
      distributionsToDate: 0
    },
    {
      id: "position-oak-bluerock",
      dealId: "oak-ridge-townhomes",
      participantId: "participant-bluerock",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 150000,
      distributionsToDate: 0
    },
    {
      id: "position-oak-elite",
      dealId: "oak-ridge-townhomes",
      participantId: "participant-elite",
      classType: "Class C",
      contributionType: "Deferred compensation",
      contributionAmount: 50000,
      distributionsToDate: 0
    },
    {
      id: "position-maple-sarah",
      dealId: "maple-flats-conversion",
      participantId: "participant-sarah",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 40000,
      distributionsToDate: 32381.49
    },
    {
      id: "position-maple-david",
      dealId: "maple-flats-conversion",
      participantId: "participant-david",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 50000,
      distributionsToDate: 80953.73
    },
    {
      id: "position-maple-olivia",
      dealId: "maple-flats-conversion",
      participantId: "participant-olivia",
      classType: "Class A",
      contributionType: "Cash equity",
      contributionAmount: 110000,
      distributionsToDate: 0
    },
    {
      id: "position-maple-northgate",
      dealId: "maple-flats-conversion",
      participantId: "participant-northgate",
      classType: "Class C",
      contributionType: "Deferred compensation",
      contributionAmount: 50000,
      distributionsToDate: 0
    }
  ],
  contractors: [
    {
      id: "contractor-237-john",
      dealId: "237-ville-development",
      participantId: "participant-john",
      contractorName: "John Rivera",
      trade: "Foundation",
      totalContractValue: 45000,
      cashPaid: 22500,
      deferredAmount: 22500,
      contributionType: "Class C",
      hybrid: true,
      status: "Active"
    },
    {
      id: "contractor-237-maya",
      dealId: "237-ville-development",
      participantId: "participant-maya",
      contractorName: "Maya Steelworks",
      trade: "Structural steel",
      totalContractValue: 125000,
      cashPaid: 62500,
      deferredAmount: 62500,
      contributionType: "Class C",
      hybrid: true,
      status: "Active"
    },
    {
      id: "contractor-oak-elite",
      dealId: "oak-ridge-townhomes",
      participantId: "participant-elite",
      contractorName: "Elite Interiors",
      trade: "Interior finishes",
      totalContractValue: 80000,
      cashPaid: 30000,
      deferredAmount: 50000,
      contributionType: "Class C",
      hybrid: true,
      status: "Active"
    },
    {
      id: "contractor-maple-northgate",
      dealId: "maple-flats-conversion",
      participantId: "participant-northgate",
      contractorName: "Northgate Demo",
      trade: "Selective demolition",
      totalContractValue: 70000,
      cashPaid: 20000,
      deferredAmount: 50000,
      contributionType: "Class C",
      hybrid: true,
      status: "Paid"
    }
  ]
};
