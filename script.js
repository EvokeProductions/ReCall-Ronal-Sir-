import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://sjhwjjaybvvyurvruott.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqaHdqamF5YnZ2eXVydnJ1b3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODQ4NjgsImV4cCI6MjA5NTU2MDg2OH0.cIf5waKhivkYpLJ5--apMwK9WHSyum1GH6iKjLfaWbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// DATA STORE
// =============================================
const DataStore = {
    async getAgents() {
        const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: true });
        if (error) { console.error('getAgents error:', error); return []; }
        return data || [];
    },
    async saveAgent(agent) {
        const { data, error } = await supabase.from('agents').upsert(agent, { onConflict: 'id' }).select();
        if (error) return { success: false, error: error.message };
        return { success: true, data: data?.[0] || null };
    },
    async deleteAgent(id) {
        const { error } = await supabase.from('agents').delete().eq('id', id);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },
    async getLeads() {
        const { data, error } = await supabase.from('leads').select('*').order('updated_at', { ascending: false });
        if (error) { console.error('getLeads error:', error); return []; }
        return data || [];
    },
    async saveLead(lead) {
        const { data, error } = await supabase.from('leads').upsert(lead, { onConflict: 'id' }).select();
        if (error) return { success: false, error: error.message };
        return { success: true, data: data?.[0] || null };
    },
    async deleteLead(id) {
        const { error } = await supabase.from('leads').delete().eq('id', id);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },
    async purgeLeads() {
        const { error } = await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        return !error;
    },
    async getSettings() {
        const { data, error } = await supabase.from('app_settings').select('*');
        if (error) return [];
        return data || [];
    },
    async updateSetting(key, value) {
        const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
        return !error;
    },
    getSession() {
        const data = localStorage.getItem('recall_session');
        return data ? JSON.parse(data) : null;
    },
    saveSession(session) { localStorage.setItem('recall_session', JSON.stringify(session)); },
    clearSession() { localStorage.removeItem('recall_session'); }
};

// =============================================
// AGENT MANAGER
// =============================================
const AgentManager = {
    _cache: [],
    async loadAll() { this._cache = await DataStore.getAgents(); return this._cache; },
    getAll() { return this._cache; },
    getById(id) { return this._cache.find(a => a.id === id); },
    getByUsername(username) { return this._cache.find(a => a.username === username.toLowerCase()); },
    async create(agentData) {
        const username = agentData.username.trim().toLowerCase();
        if (this._cache.some(a => a.username === username)) return { success: false, message: 'Username already exists' };
        const newAgent = { username, display_name: agentData.displayName.trim(), password: agentData.password, role: agentData.role };
        const result = await DataStore.saveAgent(newAgent);
        if (!result.success) return { success: false, message: result.error };
        await this.loadAll();
        return { success: true, agent: result.data };
    },
    async update(id, updates) {
        const index = this._cache.findIndex(a => a.id === id);
        if (index < 0) return { success: false, message: 'Agent not found' };
        const current = this._cache[index];
        const newUsername = (updates.username || current.username).toLowerCase();
        if (newUsername !== current.username && this._cache.some(a => a.username === newUsername)) return { success: false, message: 'Username already exists' };
        const payload = { id, username: newUsername, display_name: updates.displayName?.trim() || current.display_name, password: updates.password || current.password, role: updates.role || current.role };
        const result = await DataStore.saveAgent(payload);
        if (!result.success) return { success: false, message: result.error };
        await this.loadAll();
        return { success: true, agent: result.data };
    },
    async delete(id) {
        const agent = this._cache.find(a => a.id === id);
        if (!agent) return { success: false, message: 'Agent not found' };
        if (agent.username === 'admin') return { success: false, message: 'Cannot delete primary admin' };
        if (agent.role === 'admin' && this._cache.filter(a => a.role === 'admin').length <= 1) return { success: false, message: 'Cannot delete last admin' };
        const result = await DataStore.deleteAgent(id);
        if (!result.success) return { success: false, message: result.error };
        await this.loadAll();
        return { success: true };
    },
    getLoginOptions() { return this._cache.map(a => ({ value: a.username, label: `${a.display_name} (${a.role === 'admin' ? 'Admin' : 'Agent'})` })); }
};

// =============================================
// AUTH
// =============================================
const Auth = {
    login(username, password) {
        const agent = AgentManager.getByUsername(username);
        if (agent && agent.password === password) {
            const session = { username: agent.username, displayName: agent.display_name, role: agent.role, agentId: agent.id, loginTime: new Date().toISOString() };
            DataStore.saveSession(session);
            return { success: true, session };
        }
        return { success: false, message: 'Invalid credentials' };
    },
    logout() { DataStore.clearSession(); },
    isLoggedIn() { return DataStore.getSession() !== null; },
    getCurrentUser() { return DataStore.getSession(); },
    isAdmin() { const s = this.getCurrentUser(); return s && s.role === 'admin'; }
};

// =============================================
// LEAD MANAGER
// =============================================
const LeadManager = {
    _cache: [],
    async loadAll() { this._cache = await DataStore.getLeads(); return this._cache; },
    getAll() { return this._cache; },
    findByPhone(phone) {
        const n = this.normalizePhone(phone);
        return this._cache.find(l => this.normalizePhone(l.phone) === n);
    },
    normalizePhone(phone) { return phone.replace(/[\s\-\(\)\+\.]/g, ''); },
    async save(leadData) {
        const existingIndex = this._cache.findIndex(l =>
            this.normalizePhone(l.phone) === this.normalizePhone(leadData.phone) &&
            l.assigned_agent === (leadData.assignedAgent || null)
        );

        if (existingIndex >= 0) {
            const existing = this._cache[existingIndex];
            const isAssignment = leadData.isAssignment || false;
            const newCallCount = isAssignment ? existing.call_count : (existing.call_count || 0) + 1;

            const updated = {
                ...existing,
                lead_type: leadData.leadType || existing.lead_type,
                call_status: leadData.callStatus,
                outcome: leadData.outcome !== undefined ? leadData.outcome : existing.outcome,
                call_count: newCallCount,
                assigned_agent: leadData.assignedAgent || existing.assigned_agent,
                assigned_date: leadData.assignedDate !== undefined ? leadData.assignedDate : existing.assigned_date,
                next_follow_up_date: leadData.nextFollowUpDate !== undefined ? leadData.nextFollowUpDate : existing.next_follow_up_date,
                is_completed: leadData.isCompleted !== undefined ? leadData.isCompleted : existing.is_completed,
                remarks: leadData.remarks !== undefined ? leadData.remarks : existing.remarks,
                call_date: isAssignment ? existing.call_date : new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const result = await DataStore.saveLead(updated);
            if (result.success) { await this.loadAll(); return { isNew: false, lead: result.data, callCount: updated.call_count }; }
            return { isNew: false, lead: updated, callCount: updated.call_count, error: result.error };
        } else {
            const newLead = {
                phone: leadData.phone,
                lead_type: leadData.leadType,
                call_status: leadData.callStatus,
                outcome: leadData.outcome || null,
                call_count: 1,
                assigned_agent: leadData.assignedAgent || null,
                assigned_date: leadData.assignedDate || null,
                next_follow_up_date: leadData.nextFollowUpDate || null,
                is_completed: leadData.isCompleted || false,
                remarks: leadData.remarks || '',
                call_date: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const result = await DataStore.saveLead(newLead);
            if (result.success) { await this.loadAll(); return { isNew: true, lead: result.data, callCount: 1 }; }
            return { isNew: true, lead: newLead, callCount: 1, error: result.error };
        }
    },
    async delete(id) {
        const result = await DataStore.deleteLead(id);
        if (result.success) await this.loadAll();
        return result.success;
    },
    getFiltered(filters = {}) {
        let leads = [...this._cache];
        if (filters.search) {
            const s = filters.search.toLowerCase();
            leads = leads.filter(l => l.phone.toLowerCase().includes(s) || (l.assigned_agent && l.assigned_agent.toLowerCase().includes(s)) || (l.remarks && l.remarks.toLowerCase().includes(s)));
        }
        if (filters.leadType) leads = leads.filter(l => l.lead_type === filters.leadType);
        if (filters.callStatus) leads = leads.filter(l => l.call_status === filters.callStatus);
        if (filters.agent) leads = leads.filter(l => l.assigned_agent === filters.agent);
        return leads;
    },
    getAssignedTasks(agentName) {
        return this._cache.filter(l => l.assigned_agent === agentName && !l.is_completed && l.assigned_date && l.call_status === 'Assigned');
    },
    getTodayFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.next_follow_up_date === today && l.call_status !== 'Assigned');
    },
    getUpcomingFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.next_follow_up_date && l.next_follow_up_date > today && l.call_status !== 'Assigned');
    },
    getOverdueFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.next_follow_up_date && l.next_follow_up_date < today && l.call_status !== 'Assigned');
    },
    getFollowUpsCount(agentName = null) {
        let leads = this._cache;
        if (agentName) leads = leads.filter(l => l.assigned_agent === agentName);
        const today = new Date().toISOString().split('T')[0];
        return leads.filter(l => l.next_follow_up_date && l.next_follow_up_date <= today && l.call_status !== 'Assigned').length;
    }
};

// =============================================
// ANALYTICS
// =============================================
const Analytics = {
    getStats(agentFilter = null) {
        let leads = LeadManager.getAll();
        if (agentFilter) leads = leads.filter(l => l.assigned_agent === agentFilter);
        return {
            total: leads.length,
            answered: leads.filter(l => l.call_status === 'Answered').length,
            declined: leads.filter(l => l.call_status === 'Declined').length,
            busy: leads.filter(l => l.call_status === 'Busy').length,
            converted: leads.filter(l => l.outcome === 'Converted').length,
            prospect: leads.filter(l => l.outcome === 'Prospect').length,
            cold: leads.filter(l => l.outcome === 'Cold').length,
            outcomeDeclined: leads.filter(l => l.outcome === 'Declined').length
        };
    },
    getOutcomeDistribution(agentFilter = null) {
        let leads = LeadManager.getAll();
        if (agentFilter) leads = leads.filter(l => l.assigned_agent === agentFilter);
        return {
            'Converted': { count: leads.filter(l => l.outcome === 'Converted').length, color: 'fill-green' },
            'Prospect': { count: leads.filter(l => l.outcome === 'Prospect').length, color: 'fill-blue' },
            'Cold': { count: leads.filter(l => l.outcome === 'Cold').length, color: 'fill-gray' },
            'Declined': { count: leads.filter(l => l.outcome === 'Declined').length, color: 'fill-red' }
        };
    },
    getCallStatusDistribution(agentFilter = null) {
        let leads = LeadManager.getAll();
        if (agentFilter) leads = leads.filter(l => l.assigned_agent === agentFilter);
        return {
            'Answered': { count: leads.filter(l => l.call_status === 'Answered').length, color: 'fill-purple' },
            'Declined': { count: leads.filter(l => l.call_status === 'Declined').length, color: 'fill-red' },
            'Busy': { count: leads.filter(l => l.call_status === 'Busy').length, color: 'fill-orange' }
        };
    },
    getLeadTypeDistribution(agentFilter = null) {
        let leads = LeadManager.getAll();
        if (agentFilter) leads = leads.filter(l => l.assigned_agent === agentFilter);
        return {
            'Social Media Lead': { count: leads.filter(l => l.lead_type === 'Social Media Lead').length, color: 'fill-purple' },
            'Past Inquiry': { count: leads.filter(l => l.lead_type === 'Past Inquiry').length, color: 'fill-blue' },
            'Drop Out': { count: leads.filter(l => l.lead_type === 'Drop Out').length, color: 'fill-orange' },
            'Unpaid Fee': { count: leads.filter(l => l.lead_type === 'Unpaid Fee').length, color: 'fill-red' }
        };
    },
    getConversionRates(agentFilter = null) {
        const stats = this.getStats(agentFilter);
        const total = stats.total || 1;
        const answered = stats.answered || 1;
        return {
            'Answer Rate': ((stats.answered / total) * 100).toFixed(1) + '%',
            'Conversion Rate (of Answered)': ((stats.converted / answered) * 100).toFixed(1) + '%',
            'Prospect Rate': ((stats.prospect / answered) * 100).toFixed(1) + '%',
            'Decline Rate': ((stats.declined / total) * 100).toFixed(1) + '%'
        };
    }
};

// =============================================
// CSV EXPORTER
// =============================================
const CSVExporter = {
    exportMonthly() {
        const leads = LeadManager.getAll();
        if (leads.length === 0) { UI.showToast('No data to export', 'error'); return; }

        const agents = [...new Set(leads.map(l => l.assigned_agent).filter(Boolean))];
        const unassigned = leads.filter(l => !l.assigned_agent);
        const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

        let csv = `\uFEFFRECALL CRM — MONTHLY REPORT — ${month.toUpperCase()}\n`;
        csv += `Generated: ${new Date().toLocaleString()}\n`;
        csv += `======================================================\n\n`;

        const buildSection = (title, items) => {
            if (items.length === 0) return '';
            let section = `AGENT: ${title.toUpperCase()}\n`;
            section += `Phone,Lead Type,Call Status,Outcome,Call Count,Assigned Date,Follow-Up Date,Completed,Remarks,Call Date\n`;
            items.forEach(l => {
                section += `"${l.phone}","${l.lead_type}","${l.call_status}","${l.outcome || '-'}",${l.call_count},"${l.assigned_date || '-'}","${l.next_follow_up_date || '-'}","${l.is_completed ? 'Yes' : 'No'}","${(l.remarks || '').replace(/"/g, '""')}","${new Date(l.call_date).toLocaleString()}"\n`;
            });
            const filterVal = title === 'UNASSIGNED' ? null : title;
            const stats = Analytics.getStats(filterVal);
            section += `\nSUMMARY: Total: ${items.length} | Answered: ${stats.answered} | Converted: ${stats.converted} | Prospect: ${stats.prospect} | Cold: ${stats.cold} | Declined: ${stats.declined}\n`;
            section += `------------------------------------------------------\n\n`;
            return section;
        };

        agents.forEach(agent => {
            csv += buildSection(agent, leads.filter(l => l.assigned_agent === agent));
        });
        csv += buildSection('UNASSIGNED', unassigned);

        csv += `GRAND TOTALS\n`;
        const grand = Analytics.getStats();
        csv += `Total Calls: ${grand.total}\nAnswered: ${grand.answered}\nConverted: ${grand.converted}\nProspect: ${grand.prospect}\nCold: ${grand.cold}\nDeclined: ${grand.declined}\nBusy: ${grand.busy}\n`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Recall_Monthly_Report_${new Date().toISOString().slice(0,7)}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.showToast('Monthly CSV exported successfully', 'success');
    }
};

// =============================================
// LOADING SCREEN
// =============================================
const LoadingScreen = {
    messages: ['Connecting to cloud...', 'Loading agents...', 'Syncing leads...', 'Preparing workspace...', 'Welcome to ReCall'],
    currentMsg: 0, interval: null,
    start() {
        const el = document.getElementById('loadingStatus');
        if (!el) return;
        this.interval = setInterval(() => {
            this.currentMsg = (this.currentMsg + 1) % this.messages.length;
            el.style.opacity = '0';
            setTimeout(() => { el.textContent = this.messages[this.currentMsg]; el.style.opacity = '1'; }, 200);
        }, 600);
    },
    finish() {
        if (this.interval) clearInterval(this.interval);
        const screen = document.getElementById('loadingScreen');
        if (screen) { screen.classList.add('fade-out'); setTimeout(() => { screen.style.display = 'none'; }, 600); }
    }
};

// =============================================
// REAL-TIME SYNC
// =============================================
function setupRealtimeSync() {
    supabase.channel('recall-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async () => { await LeadManager.loadAll(); UI.refreshAll(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, async () => { await AgentManager.loadAll(); UI.populateLoginDropdown(); UI.populateAgentDropdowns(); if (UI.currentPage === 'admin') UI.renderAgents(); })
        .subscribe(status => console.log('Realtime sync:', status));
}

// =============================================
// UI MODULE
// =============================================
const UI = {
    currentPage: 'dashboard',
    editingLeadId: null,
    editingAgentId: null,
    currentFollowUpTab: 'today',

    async init() {
        LoadingScreen.start();
        this.bindEvents();
        this.updateCurrentDate();
        try {
            await AgentManager.loadAll();
            await LeadManager.loadAll();
            this.populateLoginDropdown();
            setupRealtimeSync();
            await new Promise(r => setTimeout(r, 2200));
            LoadingScreen.finish();
            setTimeout(() => {
                if (Auth.isLoggedIn()) this.showApp();
                else this.showLogin();
            }, 300);
            this.checkMonthlyCycle();
        } catch (err) {
            console.error('Init error:', err);
            LoadingScreen.finish();
            document.getElementById('loginScreen').classList.remove('hidden');
            this.showToast('Failed to connect to cloud database', 'error');
        }
    },

    async checkMonthlyCycle() {
        if (!Auth.isAdmin()) return;
        const settings = await DataStore.getSettings();
        const storedMonth = settings.find(s => s.key === 'current_cycle_month')?.value;
        const currentMonth = new Date().toISOString().slice(0, 7);
        if (storedMonth && storedMonth !== currentMonth) {
            document.getElementById('monthlyBanner').classList.remove('hidden');
        }
    },

    bindEvents() {
        document.getElementById('loginForm').addEventListener('submit', e => { e.preventDefault(); this.handleLogin(); });
        document.getElementById('loginUsername').addEventListener('change', () => document.getElementById('loginError').classList.add('hidden'));
        document.getElementById('loginPassword').addEventListener('input', () => document.getElementById('loginError').classList.add('hidden'));
        document.getElementById('passwordToggle').addEventListener('click', () => {
            const pw = document.getElementById('loginPassword');
            const eo = document.querySelector('.eye-open');
            const ec = document.querySelector('.eye-closed');
            if (pw.type === 'password') { pw.type = 'text'; eo.classList.add('hidden'); ec.classList.remove('hidden'); }
            else { pw.type = 'password'; eo.classList.remove('hidden'); ec.classList.add('hidden'); }
        });
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
        document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', e => { e.preventDefault(); this.navigateTo(l.dataset.page); document.getElementById('sidebar').classList.remove('open'); }));
        document.querySelectorAll('.bottom-nav-link').forEach(l => l.addEventListener('click', e => { e.preventDefault(); this.navigateTo(l.dataset.page); }));
        document.getElementById('mobileMenuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
        document.getElementById('addLeadBtn').addEventListener('click', () => this.openLeadModal());
        document.getElementById('leadForm').addEventListener('submit', e => { e.preventDefault(); this.handleLeadSubmit(); });
        document.getElementById('leadPhone').addEventListener('input', e => this.checkDuplicate(e.target.value));
        document.getElementById('leadCallStatus').addEventListener('change', e => {
            const outcomeGroup = document.getElementById('outcomeGroup');
            const outcomeSelect = document.getElementById('leadOutcome');
            if (e.target.value === 'Answered') {
                outcomeGroup.classList.remove('hidden');
                outcomeSelect.required = true;
            } else {
                outcomeGroup.classList.add('hidden');
                outcomeSelect.required = false;
                outcomeSelect.value = '';
            }
        });
        document.querySelectorAll('#leadModal .modal-close, #leadModal .modal-cancel, #leadModal .modal-overlay').forEach(el => el.addEventListener('click', () => this.closeModal('leadModal')));
        document.querySelectorAll('#agentModal .modal-close-agent, #agentModal .modal-overlay').forEach(el => el.addEventListener('click', () => this.closeModal('agentModal')));
        document.getElementById('agentForm').addEventListener('submit', e => { e.preventDefault(); this.handleAgentSubmit(); });
        document.getElementById('addAgentBtn').addEventListener('click', () => this.openAgentModal());
        document.querySelectorAll('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => {
            document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`adminTab${btn.dataset.adminTab.charAt(0).toUpperCase() + btn.dataset.adminTab.slice(1)}`).classList.add('active');
        }));
        document.querySelectorAll('[data-followup-tab]').forEach(btn => btn.addEventListener('click', () => {
            document.querySelectorAll('[data-followup-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.currentFollowUpTab = btn.dataset.followupTab;
            this.renderFollowUps(this.currentFollowUpTab);
        }));
        document.getElementById('searchInput').addEventListener('input', () => this.renderLeads());
        document.getElementById('filterType').addEventListener('change', () => this.renderLeads());
        document.getElementById('filterStatus').addEventListener('change', () => this.renderLeads());
        document.getElementById('filterAgent').addEventListener('change', () => this.renderLeads());
        document.getElementById('analyticsAgentFilter').addEventListener('change', () => this.renderAnalytics());
        document.getElementById('exportCsvBtn').addEventListener('click', () => CSVExporter.exportMonthly());
        document.getElementById('clearAllBtn').addEventListener('click', () => {
            this.showConfirm('Clear All Data', 'Permanently delete all leads?', async () => {
                await DataStore.purgeLeads();
                await LeadManager.loadAll();
                this.refreshAll();
                this.showToast('All data cleared', 'success');
            });
        });
        document.getElementById('monthlyExportBtn').addEventListener('click', async () => {
            CSVExporter.exportMonthly();
            await DataStore.purgeLeads();
            await DataStore.updateSetting('current_cycle_month', new Date().toISOString().slice(0, 7));
            await LeadManager.loadAll();
            document.getElementById('monthlyBanner').classList.add('hidden');
            this.refreshAll();
            this.showToast('Monthly cycle reset. Data purged.', 'success');
        });
        document.getElementById('assignForm').addEventListener('submit', async e => {
            e.preventDefault();
            await this.handleAssignmentSubmit();
        });
        document.getElementById('selectAllAgents').addEventListener('change', e => {
            const checkboxes = document.querySelectorAll('#agentCheckboxes input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
        document.addEventListener('change', e => {
            if (e.target.matches('#agentCheckboxes input[type="checkbox"]')) {
                const checkboxes = document.querySelectorAll('#agentCheckboxes input[type="checkbox"]');
                const allChecked = Array.from(checkboxes).every(cb => cb.checked);
                document.getElementById('selectAllAgents').checked = allChecked;
            }
        });
    },

    populateLoginDropdown() {
        const select = document.getElementById('loginUsername');
        select.innerHTML = '<option value="" disabled selected>Select a user</option>';
        AgentManager.getLoginOptions().forEach(opt => { const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label; select.appendChild(o); });
    },

    populateAgentDropdowns() {
        const agents = AgentManager.getAll();
        ['leadAgent', 'filterAgent', 'analyticsAgentFilter'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const first = el.options[0];
            el.innerHTML = '';
            el.appendChild(first);
            agents.forEach(a => { const o = document.createElement('option'); o.value = a.display_name; o.textContent = a.display_name; el.appendChild(o); });
        });
    },

    populateAgentCheckboxes() {
        const container = document.getElementById('agentCheckboxes');
        const currentUser = Auth.getCurrentUser();
        const agents = AgentManager.getAll().filter(a => {
            if (a.username === 'admin') return false;
            if (currentUser && a.id === currentUser.agentId) return false;
            return true;
        });

        if (agents.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No agents available for assignment.</p></div>';
            return;
        }

        container.innerHTML = agents.map(a => `
            <label class="checkbox-item">
                <input type="checkbox" name="assignedAgents" value="${this.escapeHtml(a.display_name)}">
                <span class="checkmark"></span>
                <span class="checkbox-label">${this.escapeHtml(a.display_name)}</span>
            </label>
        `).join('');
    },

    showLogin() { document.getElementById('loginScreen').classList.remove('hidden'); document.getElementById('appContainer').classList.add('hidden'); this.populateLoginDropdown(); },
    showApp() {
        document.getElementById('loginScreen').classList.add('hidden'); document.getElementById('appContainer').classList.remove('hidden');
        const user = Auth.getCurrentUser();
        this.updateUserInfo(user);
        this.toggleAdminFeatures(user.role === 'admin');
        this.populateAgentDropdowns();
        this.navigateTo('dashboard');
    },
    updateUserInfo(user) {
        document.getElementById('sidebarAvatar').textContent = user.displayName.charAt(0);
        document.getElementById('sidebarName').textContent = user.displayName;
        document.getElementById('sidebarRole').textContent = user.role === 'admin' ? 'Administrator' : 'Sales Agent';
    },
    toggleAdminFeatures(show) { document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !show)); },

    handleLogin() {
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        const errorText = document.getElementById('loginErrorText');
        const submitBtn = document.getElementById('loginSubmitBtn');
        if (!username) { errorText.textContent = 'Please select an account'; errorEl.classList.remove('hidden'); return; }
        if (!password) { errorText.textContent = 'Please enter your password'; errorEl.classList.remove('hidden'); return; }
        submitBtn.disabled = true; submitBtn.querySelector('.btn-text').textContent = 'Signing in...';
        setTimeout(() => {
            const result = Auth.login(username, password);
            if (result.success) { errorEl.classList.add('hidden'); document.getElementById('loginForm').reset(); this.showApp(); }
            else { errorText.textContent = result.message; errorEl.classList.remove('hidden'); submitBtn.disabled = false; submitBtn.querySelector('.btn-text').textContent = 'Sign In'; }
        }, 400);
    },
    handleLogout() { Auth.logout(); this.showLogin(); document.getElementById('loginPassword').value = ''; document.getElementById('loginError').classList.add('hidden'); },

    navigateTo(page) {
        this.currentPage = page;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.bottom-nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll(`[data-page="${page}"]`).forEach(l => l.classList.add('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.classList.add('active');
        const titles = { dashboard: 'Dashboard', leads: 'Leads', followups: 'Follow-Ups', analytics: 'Analytics', admin: 'Admin Panel' };
        document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
        this.renderPage(page);
    },
    renderPage(page) {
        switch (page) {
            case 'dashboard': this.renderDashboard(); break;
            case 'leads': this.renderLeads(); break;
            case 'followups': this.renderFollowUps(this.currentFollowUpTab); break;
            case 'analytics': this.renderAnalytics(); break;
            case 'admin': this.renderAdmin(); this.renderAgents(); this.renderAssignments(); this.populateAgentCheckboxes(); break;
        }
    },
    refreshAll() { this.renderPage(this.currentPage); this.populateAgentDropdowns(); },

    renderDashboard() {
        const user = Auth.getCurrentUser();
        const agentFilter = user.role === 'agent' ? user.displayName : null;
        const stats = Analytics.getStats(agentFilter);
        const followUpsCount = LeadManager.getFollowUpsCount(agentFilter);

        this.animateCounter('statTotal', stats.total);
        this.animateCounter('statAnswered', stats.answered);
        this.animateCounter('statConverted', stats.converted);
        this.animateCounter('statProspect', stats.prospect);
        this.animateCounter('statCold', stats.cold);
        this.animateCounter('statDeclined', stats.declined + stats.outcomeDeclined);
        this.animateCounter('statBusy', stats.busy);
        this.animateCounter('statFollowUps', followUpsCount);

        const tasksEl = document.getElementById('todayFollowUps');
        const todayLeads = user.role === 'agent' ? LeadManager.getTodayFollowUps().filter(l => l.assigned_agent === user.displayName) : LeadManager.getTodayFollowUps();
        tasksEl.innerHTML = todayLeads.length === 0
            ? '<div class="empty-state"><p>No follow-ups scheduled for today.</p></div>'
            : todayLeads.slice(0, 5).map(l => `
                <div class="today-item">
                    <div>
                        <div class="today-phone">${this.escapeHtml(l.phone)}</div>
                        <div class="today-type">${this.escapeHtml(l.lead_type)} · ${this.escapeHtml(l.assigned_agent || 'Unassigned')}</div>
                    </div>
                    <button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Update</button>
                </div>
            `).join('');

        const actEl = document.getElementById('recentActivity');
        let recent = LeadManager.getAll();
        if (user.role === 'agent') recent = recent.filter(l => l.assigned_agent === user.displayName);
        recent = recent.slice(0, 8);
        actEl.innerHTML = recent.length === 0
            ? '<div class="empty-state"><p>No recent activity.</p></div>'
            : recent.map(l => `<div class="activity-item"><div class="activity-dot ${this.getStatusColor(l.call_status)}"></div><div class="activity-content"><div class="activity-text"><strong>${this.escapeHtml(l.phone)}</strong> — ${this.escapeHtml(l.call_status)}${l.outcome ? ` (${l.outcome})` : ''}</div><div class="activity-time">${this.timeAgo(l.updated_at)} · ${this.escapeHtml(l.assigned_agent || 'Unknown')}</div></div></div>`).join('');
    },

    animateCounter(id, target) {
        const el = document.getElementById(id); if (!el) return;
        const cur = parseInt(el.textContent) || 0; if (cur === target) return;
        const steps = 20, inc = (target - cur) / steps; let s = 0;
        const t = setInterval(() => { s++; if (s >= steps) { el.textContent = target; clearInterval(t); } else el.textContent = Math.round(cur + inc * s); }, 20);
    },

    renderLeads() {
        const filters = {
            search: document.getElementById('searchInput').value,
            leadType: document.getElementById('filterType').value,
            callStatus: document.getElementById('filterStatus').value,
            agent: document.getElementById('filterAgent').value
        };
        const user = Auth.getCurrentUser();
        if (user.role === 'agent' && !filters.agent) filters.agent = user.displayName;
        const leads = LeadManager.getFiltered(filters);
        const c = document.getElementById('leadsList');
        c.innerHTML = leads.length === 0 ? '<div class="empty-state"><p>No leads match your filters.</p></div>' : leads.map(l => this.renderLeadItem(l)).join('');
    },

    renderLeadItem(l) {
        const today = new Date().toISOString().split('T')[0];
        const followUpBadge = l.next_follow_up_date ? `
            <span class="followup-date-badge ${l.next_follow_up_date < today ? 'overdue' : l.next_follow_up_date === today ? 'today' : ''}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                ${l.next_follow_up_date}
            </span>
        ` : '';

        return `
            <div class="lead-item ${l.next_follow_up_date && l.next_follow_up_date < today ? 'followup-overdue' : ''}">
                <div class="lead-item-info">
                    <div class="lead-item-header">
                        <span class="lead-phone">${this.escapeHtml(l.phone)}</span>
                        <span class="lead-type-badge ${this.getTypeBadgeClass(l.lead_type)}">${this.escapeHtml(l.lead_type)}</span>
                        <span class="call-count-badge">Calls: ${l.call_count}</span>
                        ${followUpBadge}
                    </div>
                    <div class="lead-meta">
                        <span class="lead-meta-item"><span class="status-dot ${this.getStatusDotClass(l.call_status)}"></span> ${this.escapeHtml(l.call_status)}</span>
                        ${l.outcome ? `<span class="lead-meta-item"><span class="status-dot status-${l.outcome.toLowerCase()}"></span> ${l.outcome}</span>` : ''}
                        <span class="lead-meta-item">Agent: ${this.escapeHtml(l.assigned_agent || 'Unassigned')}</span>
                        <span class="lead-meta-item">${this.timeAgo(l.updated_at)}</span>
                    </div>
                    ${l.remarks ? `<div class="lead-remarks">"${this.escapeHtml(l.remarks)}"</div>` : ''}
                </div>
                <div class="lead-actions">
                    <button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Update</button>
                    ${Auth.isAdmin() ? `<button class="btn btn-danger btn-xs" onclick="UI.deleteLead('${l.id}')">Delete</button>` : ''}
                </div>
            </div>
        `;
    },

    renderFollowUps(tab) {
        const user = Auth.getCurrentUser();
        let leads;
        let title;

        switch (tab) {
            case 'today':
                leads = LeadManager.getTodayFollowUps();
                title = "Today's Follow-Ups";
                break;
            case 'upcoming':
                leads = LeadManager.getUpcomingFollowUps();
                title = "Upcoming Follow-Ups";
                break;
            case 'overdue':
                leads = LeadManager.getOverdueFollowUps();
                title = "Overdue Follow-Ups";
                break;
            default:
                leads = [];
                title = "Follow-Ups";
        }

        if (user.role === 'agent') {
            leads = leads.filter(l => l.assigned_agent === user.displayName);
        }

        document.getElementById('followupTitle').textContent = title;
        document.getElementById('followupCount').textContent = leads.length;

        const c = document.getElementById('followupList');
        c.innerHTML = leads.length === 0
            ? '<div class="empty-state"><p>No follow-ups in this category.</p></div>'
            : leads.map(l => this.renderLeadItem(l)).join('');
    },

    renderAnalytics() {
        const user = Auth.getCurrentUser();
        const filterEl = document.getElementById('analyticsAgentFilter');
        let agentFilter = filterEl.value;
        if (user.role === 'agent') {
            agentFilter = user.displayName;
            filterEl.value = agentFilter;
            filterEl.disabled = true;
        } else {
            filterEl.disabled = false;
        }

        document.getElementById('chartOutcomes').innerHTML = this.renderBarChart(Analytics.getOutcomeDistribution(agentFilter));
        document.getElementById('chartCallStatus').innerHTML = this.renderBarChart(Analytics.getCallStatusDistribution(agentFilter));
        document.getElementById('chartLeadType').innerHTML = this.renderBarChart(Analytics.getLeadTypeDistribution(agentFilter));
        const cd = Analytics.getConversionRates(agentFilter);
        const cc = { 'Answer Rate': 'var(--status-purple)', 'Conversion Rate (of Answered)': 'var(--status-green)', 'Prospect Rate': 'var(--accent-blue)', 'Decline Rate': 'var(--status-red)' };
        document.getElementById('conversionRates').innerHTML = Object.entries(cd).map(([k, v]) => `<div class="conversion-item"><span class="conversion-label">${k}</span><span class="conversion-value" style="color:${cc[k] || 'var(--text-primary)'}">${v}</span></div>`).join('');
    },

    renderBarChart(data) {
        const max = Math.max(...Object.values(data).map(d => d.count), 1);
        return Object.entries(data).map(([k, { count, color }]) => `<div class="chart-bar-group"><div class="chart-bar-label"><span>${k}</span><span>${count}</span></div><div class="chart-bar-track"><div class="chart-bar-fill ${color}" style="width:${(count / max) * 100}%"></div></div></div>`).join('');
    },

    renderAdmin() {
        const leads = LeadManager.getAll();
        document.getElementById('adminTotalLeads').textContent = leads.length;
        document.getElementById('adminAnswered').textContent = leads.filter(l => l.call_status === 'Answered').length;
        document.getElementById('adminConverted').textContent = leads.filter(l => l.outcome === 'Converted').length;
        const tc = document.getElementById('adminTable');
        tc.innerHTML = leads.length === 0 ? '<div class="empty-state"><p>No leads in the database.</p></div>' : `
            <table class="admin-table"><thead><tr><th>Phone</th><th>Type</th><th>Status</th><th>Outcome</th><th>Calls</th><th>Agent</th><th>Follow-Up</th><th>Actions</th></tr></thead><tbody>
            ${leads.map(l => `<tr><td><strong>${this.escapeHtml(l.phone)}</strong></td><td>${this.escapeHtml(l.lead_type)}</td><td>${this.escapeHtml(l.call_status)}</td><td>${l.outcome || '-'}</td><td>${l.call_count}</td><td>${this.escapeHtml(l.assigned_agent || '-')}</td><td>${l.next_follow_up_date || '-'}</td><td class="admin-actions"><button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Edit</button><button class="btn btn-danger btn-xs" onclick="UI.deleteLead('${l.id}')">Delete</button></td></tr>`).join('')}
            </tbody></table>`;
    },

    renderAgents() {
        const agents = AgentManager.getAll();
        const c = document.getElementById('agentsList');
        if (agents.length === 0) { c.innerHTML = '<div class="empty-state"><p>No agents found.</p></div>'; return; }
        const leads = LeadManager.getAll();
        const cu = Auth.getCurrentUser();
        c.innerHTML = agents.map(a => {
            const lc = leads.filter(l => l.assigned_agent === a.display_name).length;
            const self = cu && cu.agentId === a.id;
            const canDel = !self && a.username !== 'admin';
            return `<div class="agent-card"><div class="agent-card-header"><div class="agent-avatar ${a.role === 'admin' ? 'admin' : ''}">${a.display_name.charAt(0)}</div><div class="agent-info"><div class="agent-name">${this.escapeHtml(a.display_name)}${self ? ' <small style="color:var(--text-muted);font-weight:400">(you)</small>' : ''}</div><div class="agent-username">@${this.escapeHtml(a.username)}</div></div></div><div><span class="agent-role-badge role-${a.role}">${a.role === 'admin' ? 'Administrator' : 'Sales Agent'}</span></div><div class="agent-meta"><span>📞 ${lc} leads</span></div><div class="agent-actions"><button class="btn btn-primary btn-xs" onclick="UI.openAgentModal('${a.id}')">Edit</button>${canDel ? `<button class="btn btn-danger btn-xs" onclick="UI.deleteAgent('${a.id}')">Delete</button>` : `<button class="btn btn-ghost btn-xs" disabled style="opacity:0.4;cursor:not-allowed">${a.username === 'admin' ? 'Protected' : 'Self'}</button>`}</div></div>`;
        }).join('');
    },

    renderAssignments() {
        const leads = LeadManager.getAll().filter(l => l.assigned_agent && l.assigned_date && l.call_status === 'Assigned');
        document.getElementById('assignmentsCount').textContent = leads.length;
        const c = document.getElementById('assignmentsList');
        c.innerHTML = leads.length === 0 ? '<div class="empty-state"><p>No active assignments.</p></div>' : leads.map(l => `
            <div class="assignment-item">
                <div class="assignment-info">
                    <span class="assignment-phone">${this.escapeHtml(l.phone)}</span>
                    <span class="assignment-meta">${this.escapeHtml(l.lead_type)} · Assigned to: <strong>${this.escapeHtml(l.assigned_agent)}</strong> · Due: ${l.assigned_date}</span>
                </div>
                <div style="display:flex;align-items:center;gap:.75rem;">
                    <span class="assignment-status ${l.is_completed ? 'status-done' : 'status-pending'}">${l.is_completed ? 'Completed' : 'Pending'}</span>
                    ${Auth.isAdmin() ? `<button class="btn btn-danger btn-xs" onclick="UI.deleteLead('${l.id}')">Remove</button>` : ''}
                </div>
            </div>
        `).join('');
    },

    openAgentModal(agentId = null) {
        this.editingAgentId = agentId;
        const form = document.getElementById('agentForm');
        const title = document.getElementById('agentModalTitle');
        const subtitle = document.getElementById('agentModalSubtitle');
        const sb = document.getElementById('agentSubmitBtn');
        const ui = document.getElementById('agentUsername');
        form.reset();
        if (agentId) {
            const a = AgentManager.getById(agentId);
            if (a) {
                title.textContent = 'Edit Agent'; subtitle.textContent = 'Update agent details';
                sb.textContent = 'Update Agent';
                document.getElementById('agentDisplayName').value = a.display_name;
                ui.value = a.username;
                document.getElementById('agentRole').value = a.role;
                document.getElementById('agentPassword').value = a.password;
                ui.readOnly = a.username === 'admin'; ui.style.opacity = a.username === 'admin' ? '0.6' : '1';
            }
        } else {
            title.textContent = 'Add New Agent'; subtitle.textContent = 'Create agent account';
            sb.textContent = 'Save Agent';
            ui.readOnly = false; ui.style.opacity = '1';
        }
        document.getElementById('agentModal').classList.remove('hidden');
    },

    async handleAgentSubmit() {
        const dn = document.getElementById('agentDisplayName').value.trim();
        const un = document.getElementById('agentUsername').value.trim();
        const ro = document.getElementById('agentRole').value;
        const pw = document.getElementById('agentPassword').value;
        if (!dn || !un || !pw) { this.showToast('Fill in all fields', 'error'); return; }
        if (pw.length < 4) { this.showToast('Password min 4 chars', 'error'); return; }
        let result;
        if (this.editingAgentId) result = await AgentManager.update(this.editingAgentId, { displayName: dn, username: un, role: ro, password: pw });
        else result = await AgentManager.create({ displayName: dn, username: un, role: ro, password: pw });
        if (result.success) {
            this.showToast(this.editingAgentId ? 'Agent updated' : 'Agent added', 'success');
            this.closeModal('agentModal');
            const cu = Auth.getCurrentUser();
            if (this.editingAgentId && cu && cu.agentId === this.editingAgentId) { cu.displayName = dn; cu.role = ro; DataStore.saveSession(cu); this.updateUserInfo(cu); this.toggleAdminFeatures(ro === 'admin'); }
            this.renderAgents(); this.populateLoginDropdown(); this.populateAgentDropdowns();
        } else this.showToast(result.message, 'error');
    },

    deleteAgent(id) {
        const a = AgentManager.getById(id); if (!a) return;
        this.showConfirm('Delete Agent', `Delete "${a.display_name}" (@${a.username})?`, async () => {
            const r = await AgentManager.delete(id);
            if (r.success) { this.showToast('Agent deleted', 'success'); this.renderAgents(); this.populateLoginDropdown(); this.populateAgentDropdowns(); }
            else this.showToast(r.message, 'error');
        });
    },

    openLeadModal(leadId = null) {
        this.editingLeadId = leadId;
        const form = document.getElementById('leadForm');
        const title = document.getElementById('modalTitle');
        const subtitle = document.getElementById('modalSubtitle');
        const sb = document.getElementById('leadSubmitBtn');
        const pi = document.getElementById('leadPhone');
        const dm = document.getElementById('phoneDuplicateMsg');
        const outcomeGroup = document.getElementById('outcomeGroup');
        const outcomeSelect = document.getElementById('leadOutcome');
        const banner = document.getElementById('agentBanner');
        const bannerName = document.getElementById('bannerAgentName');

        form.reset(); dm.classList.add('hidden');
        this.populateAgentDropdowns();
        outcomeGroup.classList.add('hidden'); outcomeSelect.required = false;

        const user = Auth.getCurrentUser();

        // Agent banner for agents (they're recording their own call)
        if (user.role === 'agent') {
            banner.classList.remove('hidden');
            bannerName.textContent = user.displayName;
        } else {
            banner.classList.add('hidden');
        }

        if (leadId) {
            const l = LeadManager.getAll().find(x => x.id === leadId);
            if (l) {
                title.textContent = 'Update Lead'; subtitle.textContent = 'Editing call record';
                sb.textContent = 'Update Lead';
                pi.value = l.phone; pi.readOnly = true;
                document.getElementById('leadType').value = l.lead_type;
                document.getElementById('leadCallStatus').value = l.call_status;
                document.getElementById('leadFollowUpDate').value = l.next_follow_up_date || '';
                document.getElementById('leadRemarks').value = l.remarks || '';
                if (l.call_status === 'Answered') {
                    outcomeGroup.classList.remove('hidden');
                    outcomeSelect.required = true;
                    outcomeSelect.value = l.outcome || '';
                }
            }
        } else {
            title.textContent = 'Add New Lead'; subtitle.textContent = 'Record call information';
            sb.textContent = 'Save Lead';
            pi.readOnly = false;
            // Set min date for follow-up to today
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('leadFollowUpDate').min = today;
        }
        document.getElementById('leadModal').classList.remove('hidden');
    },

    async handleLeadSubmit() {
        const phone = document.getElementById('leadPhone').value.trim();
        const lt = document.getElementById('leadType').value;
        const cs = document.getElementById('leadCallStatus').value;
        const outcome = document.getElementById('leadOutcome').value;
        const followUpDate = document.getElementById('leadFollowUpDate').value;
        const rm = document.getElementById('leadRemarks').value.trim();

        if (!phone || !lt || !cs) { this.showToast('Fill in all required fields', 'error'); return; }
        if (cs === 'Answered' && !outcome) { this.showToast('Select an outcome for answered calls', 'error'); return; }

        const user = Auth.getCurrentUser();
        // Always auto-assign to current user (recorded call by them)
        const assignedAgent = user.displayName;

        const result = await LeadManager.save({
            phone, leadType: lt, callStatus: cs, outcome,
            assignedAgent: assignedAgent,
            nextFollowUpDate: followUpDate || null,
            remarks: rm,
            isCompleted: true // Recorded call = always completed
        });

        if (result.error) { this.showToast(`Error: ${result.error}`, 'error'); return; }
        if (result.isNew) {
            this.showToast(followUpDate ? `Lead created — follow-up set for ${followUpDate}` : 'New lead created', 'success');
        } else {
            this.showToast(`Lead updated — Call #${result.callCount}`, 'success');
        }
        this.closeModal('leadModal'); this.refreshAll();
    },

    async handleAssignmentSubmit() {
        const phone = document.getElementById('assignPhone').value.trim();
        const type = document.getElementById('assignType').value;
        const date = document.getElementById('assignDate').value;
        const remarks = document.getElementById('assignRemarks').value.trim();

        if (!phone || !type || !date) {
            this.showToast('Fill in all required fields', 'error');
            return;
        }

        const checkboxes = document.querySelectorAll('#agentCheckboxes input[type="checkbox"]:checked');
        const selectedAgents = Array.from(checkboxes).map(cb => cb.value);

        if (selectedAgents.length === 0) {
            this.showToast('Select at least one agent', 'error');
            return;
        }

        let successCount = 0;
        for (const agentName of selectedAgents) {
            const result = await LeadManager.save({
                phone,
                leadType: type,
                callStatus: 'Assigned',
                assignedAgent: agentName,
                assignedDate: date,
                remarks,
                isCompleted: false,
                isAssignment: true // Mark as future assignment, don't increment call count
            });
            if (!result.error) successCount++;
        }

        if (successCount === selectedAgents.length) {
            this.showToast(`Lead assigned to ${successCount} agent${successCount > 1 ? 's' : ''}`, 'success');
        } else {
            this.showToast(`Assigned to ${successCount} of ${selectedAgents.length} agents`, 'error');
        }

        document.getElementById('assignForm').reset();
        document.getElementById('selectAllAgents').checked = false;
        this.renderAssignments();
    },

    checkDuplicate(phone) {
        const dm = document.getElementById('phoneDuplicateMsg');
        if (phone.length > 5) {
            const ex = LeadManager.findByPhone(phone);
            if (ex) { dm.classList.remove('hidden'); dm.textContent = `Existing lead — called ${ex.call_count} time(s)`; }
            else dm.classList.add('hidden');
        } else dm.classList.add('hidden');
    },

    async deleteLead(id) {
        this.showConfirm('Delete Lead', 'Permanently delete this lead?', async () => {
            await LeadManager.delete(id); this.refreshAll(); this.showToast('Lead deleted', 'success');
        });
    },

    closeModal(id) { document.getElementById(id).classList.add('hidden'); },
    showConfirm(title, msg, onConfirm) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = msg;
        document.getElementById('confirmModal').classList.remove('hidden');
        const ok = document.getElementById('confirmOk'), cn = document.getElementById('confirmCancel'), ov = document.querySelector('#confirmModal .modal-overlay');
        const nok = ok.cloneNode(true); ok.parentNode.replaceChild(nok, ok);
        const ncn = cn.cloneNode(true); cn.parentNode.replaceChild(ncn, cn);
        nok.addEventListener('click', () => { onConfirm(); this.closeModal('confirmModal'); });
        ncn.addEventListener('click', () => this.closeModal('confirmModal'));
        ov.addEventListener('click', () => this.closeModal('confirmModal'), { once: true });
    },

    updateCurrentDate() { document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); },
    showToast(msg, type = 'success') { const t = document.getElementById('toast'); document.getElementById('toastMessage').textContent = msg; t.className = `toast ${type}`; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3000); },
    timeAgo(iso) { if (!iso) return ''; const s = Math.floor((new Date() - new Date(iso)) / 1000); if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); },
    getStatusDotClass(s) { return { 'Answered': 'status-answered', 'Declined': 'status-declined', 'Busy': 'status-busy', 'Assigned': 'status-assigned' }[s] || 'status-answered'; },
    getStatusColor(s) { return this.getStatusDotClass(s); },
    getTypeBadgeClass(t) { return { 'Social Media Lead': 'badge-social', 'Past Inquiry': 'badge-past', 'Drop Out': 'badge-drop', 'Unpaid Fee': 'badge-unpaid' }[t] || 'badge-social'; },
    escapeHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
};

// =============================================
// INITIALIZE & GLOBAL EXPOSURE
// =============================================
document.addEventListener('DOMContentLoaded', () => UI.init());

window.UI = UI;
window.AgentManager = AgentManager;
window.LeadManager = LeadManager;
window.Auth = Auth;
window.CSVExporter = CSVExporter;
window.DataStore = DataStore;
window.Analytics = Analytics;
window.supabase = supabase;
