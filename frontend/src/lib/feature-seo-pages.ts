export type FeatureSeoFaq = {
  question: string;
  answer: string;
};

export type FeatureSeoPage = {
  slug: string;
  keyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  intent: string;
  primaryRoute: string;
  primaryCtaLabel: string;
  secondaryRoute: string;
  secondaryCtaLabel: string;
  coreBenefits: string[];
  useCases: string[];
  howItWorks: string[];
  faqs: FeatureSeoFaq[];
  searchPhrases: string[];
};

export const featureSeoPages: FeatureSeoPage[] = [
  {
    slug: "jd-matcher-tool-for-resume-screening",
    keyword: "jd matcher tool",
    title: "JD Matcher Tool for Resume Screening",
    metaDescription:
      "Compare resume and job description with AI to get match percentage, matched skills, missing skills, and a clear action plan before applying.",
    h1: "JD Matcher Tool for Resume Screening",
    intro:
      "Use HireScore to compare your resume against a job description before applying. You get skill overlap, missing requirements, and practical fixes to improve shortlist probability.",
    intent: "Check resume-job fit and identify gaps before submitting applications.",
    primaryRoute: "/application-copilot",
    primaryCtaLabel: "Run JD Match",
    secondaryRoute: "/pricing",
    secondaryCtaLabel: "View Plan Features",
    coreBenefits: [
      "Match percentage with role-fit explanation.",
      "Matched skills section based on resume evidence.",
      "Missing skills section mapped to JD requirements.",
      "Improvement suggestions and next-step actions.",
    ],
    useCases: [
      "Job switch candidates targeting product or service companies.",
      "Freshers validating fit before high-volume applications.",
      "Experienced professionals customizing resume versions per role.",
    ],
    howItWorks: [
      "Upload your resume and JD file, or paste JD text directly.",
      "Run AI-powered matching to detect matched and missing skills.",
      "Use suggestions to update resume and apply with higher confidence.",
    ],
    faqs: [
      {
        question: "Can I run JD matching without a JD file?",
        answer: "Yes. You can paste the JD text if you do not have a PDF or image.",
      },
      {
        question: "Does it show matched skills or only keywords?",
        answer: "It shows matched skills, missing skills, and supporting context from your resume.",
      },
      {
        question: "Will this improve shortlist conversion?",
        answer: "It improves preparation quality by helping you fix high-impact gaps before applying.",
      },
    ],
    searchPhrases: [
      "jd matcher tool",
      "resume jd match checker",
      "resume vs job description match",
      "jd match score for resume",
      "ai jd matcher online",
    ],
  },
  {
    slug: "resume-vs-jd-match-score-checker",
    keyword: "resume vs jd match score checker",
    title: "Resume vs JD Match Score Checker",
    metaDescription:
      "Check resume vs JD fit instantly with AI-based skill matching, missing skills detection, and role relevance guidance for faster interview outcomes.",
    h1: "Resume vs JD Match Score Checker",
    intro:
      "Before applying, validate your profile against the JD. HireScore helps you understand how well your current resume aligns and what to improve first.",
    intent: "Get a fast, clear match score before applying to a role.",
    primaryRoute: "/application-copilot",
    primaryCtaLabel: "Check Match Score",
    secondaryRoute: "/analysis",
    secondaryCtaLabel: "Open Analysis",
    coreBenefits: [
      "Quick match score with practical explanation.",
      "Role relevance check to detect mismatch risk.",
      "Priority fixes for missing requirements.",
      "Ready-to-use next steps for the same role.",
    ],
    useCases: [
      "Candidates applying to multiple roles with different JDs.",
      "Users reworking one resume into role-specific versions.",
      "Applicants preparing for urgent hiring openings.",
    ],
    howItWorks: [
      "Paste JD text or upload JD and resume.",
      "System analyzes overlap and missing requirements.",
      "Apply suggested fixes, then rerun score before submission.",
    ],
    faqs: [
      {
        question: "Is match score enough to judge final outcome?",
        answer: "Use it as a guidance layer with recruiter context, role seniority, and interview readiness.",
      },
      {
        question: "Can I compare multiple JDs quickly?",
        answer: "Yes. You can run repeated checks for each target role.",
      },
      {
        question: "Does it support non-tech roles?",
        answer: "Yes. It works across major domains with role-specific signals.",
      },
    ],
    searchPhrases: [
      "resume vs jd score checker",
      "job description match score",
      "resume fit score for job",
      "resume and jd skill match",
      "profile match checker for jobs",
    ],
  },
  {
    slug: "ai-resume-studio-ats-resume-builder",
    keyword: "ai resume studio",
    title: "AI Resume Studio and ATS Resume Builder",
    metaDescription:
      "Build ATS-friendly resumes with AI guidance, role-focused content blocks, and export-ready formatting designed for recruiter scanning.",
    h1: "AI Resume Studio and ATS Resume Builder",
    intro:
      "Create cleaner, role-focused resumes with guided sections and AI-assisted drafting. HireScore helps you build for clarity, ATS compatibility, and recruiter readability.",
    intent: "Build and optimize resume quality for ATS and recruiter reviews.",
    primaryRoute: "/ai-resume-studio",
    primaryCtaLabel: "Open AI Resume Studio",
    secondaryRoute: "/studio",
    secondaryCtaLabel: "Go To Resume Builder",
    coreBenefits: [
      "Structured resume sections with role-first positioning.",
      "AI guidance for better bullet quality and clarity.",
      "ATS-safe formatting with export-ready output.",
      "Improvement loop using analysis insights.",
    ],
    useCases: [
      "Freshers building their first professional resume.",
      "Mid-career professionals preparing role-specific versions.",
      "Candidates fixing low callback rates from existing resumes.",
    ],
    howItWorks: [
      "Start from your target role and skill profile.",
      "Generate or refine resume sections with guided AI prompts.",
      "Export polished resume and validate using analysis tools.",
    ],
    faqs: [
      {
        question: "Is this only a template editor?",
        answer: "No. It combines content guidance, structure support, and role-fit direction.",
      },
      {
        question: "Can I use it after JD match?",
        answer: "Yes. It is ideal for fixing gaps discovered in JD matching.",
      },
      {
        question: "Will the resume be ATS friendly?",
        answer: "The builder is designed for clean, machine-readable structure and recruiter scan speed.",
      },
    ],
    searchPhrases: [
      "ai resume studio",
      "ats resume builder ai",
      "resume builder for job switch",
      "professional resume creator online",
      "resume optimization studio",
    ],
  },
  {
    slug: "resume-analysis-shortlist-prediction-tool",
    keyword: "resume analysis and shortlist prediction",
    title: "Resume Analysis and Shortlist Prediction Tool",
    metaDescription:
      "Analyze your resume quality, role fit, and shortlist probability with AI feedback that helps prioritize what to improve first.",
    h1: "Resume Analysis and Shortlist Prediction Tool",
    intro:
      "Know where your resume stands before applying. HireScore analysis highlights quality issues, missing relevance signals, and an execution roadmap.",
    intent: "Measure current profile readiness and prioritize improvements.",
    primaryRoute: "/analysis",
    primaryCtaLabel: "Run Resume Analysis",
    secondaryRoute: "/instant-fit",
    secondaryCtaLabel: "Try Instant Fit Check",
    coreBenefits: [
      "Profile quality review with role-fit direction.",
      "Shortlist probability guidance before application.",
      "Improvement roadmap with practical execution order.",
      "Reusable feedback loop across job targets.",
    ],
    useCases: [
      "Candidates not getting interview calls despite applications.",
      "Job switchers planning targeted resume upgrades.",
      "Users benchmarking profile quality over time.",
    ],
    howItWorks: [
      "Provide role context and resume input.",
      "Run analysis for fit score and confidence indicators.",
      "Apply fixes and track quality improvements in next runs.",
    ],
    faqs: [
      {
        question: "What is shortlist prediction used for?",
        answer: "It helps prioritize where to invest effort before you apply widely.",
      },
      {
        question: "Can I rerun after resume edits?",
        answer: "Yes. Reruns help validate if your updates improved role alignment.",
      },
      {
        question: "Is this useful for experienced candidates?",
        answer: "Yes. It supports both early-career and experienced profiles.",
      },
    ],
    searchPhrases: [
      "resume analysis tool",
      "shortlist prediction resume",
      "resume quality checker",
      "ai resume analysis online",
      "why resume not shortlisted",
    ],
  },
  {
    slug: "ai-interview-simulator-with-feedback",
    keyword: "ai interview simulator",
    title: "AI Interview Simulator With Feedback",
    metaDescription:
      "Practice mock interviews with realistic question flow, audio-video setup, and structured AI feedback to improve confidence and answer quality.",
    h1: "AI Interview Simulator With Feedback",
    intro:
      "Simulate real interview rounds before the actual call. HireScore provides practice structure, question flow, and post-round feedback for focused improvement.",
    intent: "Practice interviews in a realistic environment and improve responses.",
    primaryRoute: "/interview-simulator",
    primaryCtaLabel: "Start Interview Simulation",
    secondaryRoute: "/interview-prep",
    secondaryCtaLabel: "Open Interview Prep",
    coreBenefits: [
      "Role-based question simulation in structured rounds.",
      "Audio and video interaction for realistic prep.",
      "Feedback on response quality and improvement points.",
      "Practice history to monitor readiness over time.",
    ],
    useCases: [
      "Candidates preparing for first-round screening interviews.",
      "Users improving communication confidence before final rounds.",
      "Jobseekers practicing role-specific examples and storytelling.",
    ],
    howItWorks: [
      "Set target role and run interview simulation.",
      "Respond through text, audio, or camera-enabled setup.",
      "Review feedback and refine answers for next attempts.",
    ],
    faqs: [
      {
        question: "Can I practice without login?",
        answer: "Yes. There is a free run option for first-time users.",
      },
      {
        question: "Does it support technical and non-technical roles?",
        answer: "Yes. The simulator adapts question sets by role context.",
      },
      {
        question: "Can I use resume and JD as context?",
        answer: "Yes. Uploading context improves relevance of practice rounds.",
      },
    ],
    searchPhrases: [
      "ai interview simulator",
      "mock interview practice online",
      "interview simulation with feedback",
      "video interview practice tool",
      "live interview prep platform",
    ],
  },
  {
    slug: "mock-interview-practice-for-freshers",
    keyword: "mock interview practice for freshers",
    title: "Mock Interview Practice for Freshers",
    metaDescription:
      "Prepare for fresher interviews with guided mock rounds, feedback on answer clarity, and practical next steps to improve selection chances.",
    h1: "Mock Interview Practice for Freshers",
    intro:
      "Freshers often struggle with structured answers. This page helps you practice the right format and build confidence before real interviews.",
    intent: "Prepare freshers for screening interviews with practical practice loops.",
    primaryRoute: "/interview-simulator",
    primaryCtaLabel: "Practice Fresher Interview",
    secondaryRoute: "/ai-resume-studio",
    secondaryCtaLabel: "Build Fresher Resume",
    coreBenefits: [
      "Role-friendly question sets for early-career candidates.",
      "Simple feedback that focuses on clarity and examples.",
      "Progressive practice rounds to reduce hesitation.",
      "Linked preparation flow from resume to interview.",
    ],
    useCases: [
      "Campus applicants entering first job market.",
      "Freshers with low confidence in spoken answers.",
      "Candidates transitioning from project-based profiles to interview-ready communication.",
    ],
    howItWorks: [
      "Choose role and start your fresher simulation.",
      "Answer questions in your own words with clear examples.",
      "Review feedback and repeat practice with improvements.",
    ],
    faqs: [
      {
        question: "How long should each answer be?",
        answer: "Most effective answers are clear, specific, and usually around one minute.",
      },
      {
        question: "Should I memorize responses?",
        answer: "No. Use a structure and speak naturally using real project evidence.",
      },
      {
        question: "Can this help with HR rounds?",
        answer: "Yes. It supports behavioral and role-context interview preparation.",
      },
    ],
    searchPhrases: [
      "mock interview for freshers",
      "fresher interview practice online",
      "first job interview simulator",
      "campus interview prep tool",
      "hr interview practice for freshers",
    ],
  },
  {
    slug: "instant-fit-check-for-job-applications",
    keyword: "instant fit check",
    title: "Instant Fit Check for Job Applications",
    metaDescription:
      "Run a quick role-fit check before applying. Identify resume quality risk, alignment strength, and next action in minutes.",
    h1: "Instant Fit Check for Job Applications",
    intro:
      "When you need a fast decision, Instant Fit Check gives immediate profile feedback so you can prioritize higher-probability applications.",
    intent: "Get fast quality and fit signals for quick application decisions.",
    primaryRoute: "/instant-fit",
    primaryCtaLabel: "Run Instant Fit Check",
    secondaryRoute: "/application-copilot",
    secondaryCtaLabel: "Open Full Copilot",
    coreBenefits: [
      "Fast fit signal before investing in full application.",
      "Immediate direction on profile quality risks.",
      "Clear action path to deeper analysis when needed.",
      "Ideal for rapid role filtering during active job search.",
    ],
    useCases: [
      "Users reviewing many openings in limited time.",
      "Candidates deciding which roles deserve full customization.",
      "Applicants validating baseline readiness before outreach.",
    ],
    howItWorks: [
      "Provide your role context and profile summary.",
      "Run instant scan for fit and quality indicators.",
      "Move to deeper tools for JD matching and interview prep.",
    ],
    faqs: [
      {
        question: "Is this different from full analysis?",
        answer: "Yes. It is faster and lighter, designed for early filtering decisions.",
      },
      {
        question: "Can I use this before every application batch?",
        answer: "Yes. It is suited for repeated quick checks.",
      },
      {
        question: "Does it replace JD matching?",
        answer: "Use instant check first, then JD matching for detailed skill comparison.",
      },
    ],
    searchPhrases: [
      "instant fit check",
      "quick resume fit checker",
      "fast job match scan",
      "resume readiness quick check",
      "pre application fit checker",
    ],
  },
  {
    slug: "application-copilot-for-job-switch",
    keyword: "application copilot",
    title: "Application Copilot for Job Switch Candidates",
    metaDescription:
      "Use one workflow for JD matching, resume improvements, and interview next steps to move from application chaos to execution clarity.",
    h1: "Application Copilot for Job Switch Candidates",
    intro:
      "Application Copilot combines key steps in one flow: JD matching, skill gap detection, resume feedback, and interview preparation guidance.",
    intent: "Run complete job-application execution from one console.",
    primaryRoute: "/application-copilot",
    primaryCtaLabel: "Open Application Copilot",
    secondaryRoute: "/interview-simulator",
    secondaryCtaLabel: "Practice Interview",
    coreBenefits: [
      "Single workflow from JD to interview-ready execution.",
      "Matched skills and missing skills in one view.",
      "Actionable feedback with prioritized next steps.",
      "Less context switching between disconnected tools.",
    ],
    useCases: [
      "Working professionals planning a structured job switch.",
      "Candidates applying to competitive roles with high rejection rates.",
      "Users who need one command center for application tasks.",
    ],
    howItWorks: [
      "Upload resume and JD, then run full workflow.",
      "Review match quality, feedback, and improvement actions.",
      "Apply updates and continue with interview simulation rounds.",
    ],
    faqs: [
      {
        question: "Is this only for tech candidates?",
        answer: "No. It supports a broad range of job families.",
      },
      {
        question: "Can I use this with old resumes?",
        answer: "Yes. It is designed to improve existing resumes too.",
      },
      {
        question: "What output do I get after run?",
        answer: "You get match percentage, skills mapping, feedback, and next-step recommendations.",
      },
    ],
    searchPhrases: [
      "application copilot",
      "job application workflow tool",
      "resume jd interview prep in one",
      "ai job switch assistant",
      "job application command center",
    ],
  },
  {
    slug: "interview-prep-plan-from-resume-and-jd",
    keyword: "interview prep plan from resume and jd",
    title: "Interview Prep Plan From Resume and JD",
    metaDescription:
      "Generate a focused interview preparation roadmap using your resume and JD context so practice aligns to real role expectations.",
    h1: "Interview Prep Plan From Resume and JD",
    intro:
      "Interview prep is stronger when it is role-specific. HireScore turns your profile and JD context into a practical preparation plan with focused practice priorities.",
    intent: "Build a role-focused interview preparation roadmap from real context.",
    primaryRoute: "/interview-prep",
    primaryCtaLabel: "Generate Interview Prep Plan",
    secondaryRoute: "/interview-simulator",
    secondaryCtaLabel: "Run Live Simulation",
    coreBenefits: [
      "Preparation roadmap aligned to your target role.",
      "Priority focus areas based on role requirements.",
      "Practice structure that connects resume proof to questions.",
      "Next steps for confidence and answer quality.",
    ],
    useCases: [
      "Candidates preparing for interviews in one to two weeks.",
      "Users struggling to prioritize prep topics.",
      "Applicants with role changes needing targeted storytelling.",
    ],
    howItWorks: [
      "Provide resume and JD context inputs.",
      "Generate focused preparation checkpoints.",
      "Practice with simulator and iterate using feedback.",
    ],
    faqs: [
      {
        question: "Can this replace manual prep notes?",
        answer: "It can structure your prep and save time, but your own examples are still important.",
      },
      {
        question: "Does it help with behavioral rounds?",
        answer: "Yes. It supports practical preparation for common interview themes.",
      },
      {
        question: "Should I use this before simulator runs?",
        answer: "Yes. Starting with a focused plan improves simulator outcomes.",
      },
    ],
    searchPhrases: [
      "interview prep from jd",
      "resume based interview plan",
      "role specific interview preparation",
      "interview roadmap generator",
      "job interview prep ai",
    ],
  },
];

export const getFeatureSeoPageBySlug = (slug: string) => {
  return featureSeoPages.find((page) => page.slug === slug);
};

export const getRelatedFeatureSeoPages = (slug: string, limit = 3) => {
  const currentIndex = featureSeoPages.findIndex((page) => page.slug === slug);
  if (currentIndex === -1) return featureSeoPages.slice(0, limit);

  const rotated = [...featureSeoPages.slice(currentIndex + 1), ...featureSeoPages.slice(0, currentIndex)];
  return rotated.slice(0, limit);
};
