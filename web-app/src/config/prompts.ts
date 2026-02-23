import {
    Activity,
    BookOpen,
    FileText,
    Users,
    Server,
    BarChart3,
    Search,
    ClipboardCheck,
    Cloud,
    Database,
    Lock
} from 'lucide-react'
import { PromptTemplate } from '../types/prompt'

export const PROMPT_TEMPLATES: PromptTemplate[] = [
    // Universal Agent
    {
        id: 'universal-plan',
        title: 'Cross-Team Incident Plan',
        description: 'Coordinated response plan with owners and timeline.',
        agentId: 'universal-agent',
        icon: Users,
        prompt: 'Create a cross-team response plan for a P1 production incident, including role ownership, 30/60/120-minute action checklists, escalation/sync mechanisms, and postmortem preparation tasks.'
    },
    {
        id: 'arch-review',
        title: 'Architecture Review Board',
        description: 'Prepare ARB presentation for microservice migration.',
        agentId: 'universal-agent',
        icon: Server,
        prompt: 'Prepare an ARB (Architecture Review Board) presentation structure for a new microservice migration. Include context, options considered, trade-off analysis, and rollout plan.'
    },
    {
        id: 'post-mortem',
        title: 'Post-Mortem Orchestration',
        description: 'Guide team through blameless post-mortem analysis.',
        agentId: 'universal-agent',
        icon: Activity,
        prompt: 'Guide the team through a blameless post-mortem analysis for the recent outage. Structure the session to cover timeline, root cause, impact, and preventive actions.'
    },
    {
        id: 'capacity-plan',
        title: 'Capacity Planning Strategy',
        description: 'Analyze resource usage and propose scaling strategy.',
        agentId: 'universal-agent',
        icon: BarChart3,
        prompt: 'Analyze current resource usage trends and propose a scaling strategy for Q4. Consider cost optimization and peak load handling.'
    },
    {
        id: 'cloud-cost',
        title: 'Cloud Cost Optimization',
        description: 'Identify idle resources and suggest savings.',
        agentId: 'universal-agent',
        icon: Cloud,
        prompt: 'Analyze the current cloud infrastructure bill and identify idle resources or over-provisioned instances. Suggest specific actions to reduce monthly spend by 20%.'
    },
    {
        id: 'project-roadmap',
        title: 'Project Roadmap',
        description: 'Draft a quarterly roadmap with milestones.',
        agentId: 'universal-agent',
        icon: FileText,
        prompt: 'Draft a quarterly roadmap for the "Cloud Migration" project. Include key milestones, dependencies, and resource allocation requirements.'
    },
    {
        id: 'team-agenda',
        title: 'Team Sync Agenda',
        description: 'Create an agenda for the weekly sync.',
        agentId: 'universal-agent',
        icon: Users,
        prompt: 'Create an agenda for the weekly engineering team sync. Topics should include: sprint progress, blocker resolution, and design reviews.'
    },

    // KB Agent
    {
        id: 'kb-incident-qa',
        title: 'Incident Knowledge Q&A',
        description: 'Retrieve similar incidents and provide guidance.',
        agentId: 'kb-agent',
        icon: BookOpen,
        prompt: 'Search the knowledge base for historical cases related to "database connection timeout". Return: similar case summaries, troubleshooting paths, reusable fixes, and risk notes.'
    },
    {
        id: 'error-log',
        title: 'Error Log Analysis',
        description: 'Analyze stack traces against known solutions.',
        agentId: 'kb-agent',
        icon: Search,
        prompt: 'Analyze these Java stack traces and match against known solutions in the knowledge base. Identify potential root causes.'
    },
    {
        id: 'runbook-retrieval',
        title: 'Runbook Retrieval',
        description: 'Find SOP for specific operations tasks.',
        agentId: 'kb-agent',
        icon: FileText,
        prompt: 'Find and summarize the standard operating procedure (runbook) for Kafka partition reassignment. List the critical steps and safety checks.'
    },
    {
        id: 'db-tuning',
        title: 'Database Tuning Guide',
        description: 'Find best practices for query optimization.',
        agentId: 'kb-agent',
        icon: Database,
        prompt: 'Search the knowledge base for best practices regarding PostgreSQL query optimization. Summarize index strategies and configuration parameters for high-write workloads.'
    },
    {
        id: 'api-docs',
        title: 'API Documentation',
        description: 'Find the internal API docs for the payment service.',
        agentId: 'kb-agent',
        icon: BookOpen,
        prompt: 'Find the internal API documentation for the payment service. Specifically, look for the "initiate_refund" endpoint and its required parameters.'
    },
    {
        id: 'onboarding-guide',
        title: 'Onboarding Guide',
        description: 'Retrieve the new hire checklist.',
        agentId: 'kb-agent',
        icon: ClipboardCheck,
        prompt: 'Retrieve the new hire onboarding checklist for the Platform Engineering team. Include access requests, required training, and first-week tasks.'
    },
    {
        id: 'security-policy',
        title: 'Security Policy',
        description: 'Find the password rotation policy.',
        agentId: 'kb-agent',
        icon: Lock,
        prompt: 'Find the company\'s password rotation policy and Multi-Factor Authentication (MFA) requirements for production access.'
    },
]
