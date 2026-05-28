/* ============================================
   ReCall — Cloud-Synced Application Logic
   Supabase Integration + Real-Time Sync
   by Evoke Productions
   ============================================ */

// =============================================
// SUPABASE CLIENT SETUP
// =============================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://sjhwjjaybvvyurvruott.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqaHdqamF5YnZ2eXVydnJ1b3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODQ4NjgsImV4cCI6MjA5NTU2MDg2OH0.cIf5waKhivkYpLJ5--apMwK9WHSyum1GH6iKjLfaWbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// DATA STORE (Cloud Version)
// =============================================
const DataStore = {
    // --- AGENTS ---
    async getAgents() {
        const { data, error } = await supabase
            .from('agents')
            .select('*')
            .order('created_at', { ascending: true });
        if (error) {
            console.error('getAgents error:', error);
            return [];
        }
        return data || [];
    },

    async saveAgent(agent) {
        const { data, error } = await supabase
            .from('agents')
            .upsert(agent, { onConflict: 'id' })
            .select();
        if (error) {
            console.error('saveAgent error:', error);
            return { success: false, error: error.message };
        }
        return { success: true, data: data?.[0] || null };
    },

    async deleteAgent(id) {
        const { error } = await supabase.from('agents').delete().eq('id', id);
        if (error) {
            console.error('deleteAgent error:', error);
            return { success: false, error: error.message };
        }
        return { success: true };
    },

    // --- LEADS ---
    async getLeads() {
        const { data, error } = await supabase
            .from('leads')
            .select('*')
            .order('last_updated', { ascending: false });
        if (error) {
            console.error('getLeads error:', error);
            return [];
        }
        return data || [];
    },

    async saveLead(lead) {
        const { data, error } = await supabase
            .from('leads')
            .upsert(lead, { onConflict: 'id' })
            .select();
        if (error) {
            console.error('saveLead error:', error);
            return { success: false, error: error.message };
        }
        return { success: true, data: data?.[0] || null };
    },

    async deleteLead(id) {
        const { error } = await supabase.from('leads').delete().eq('id', id);
        if (error) {
            console.error('deleteLead error:', error);
            return { success: false, error: error.message };
        }
        return { success: true };
    },

    // --- SESSION (still local — sessions are per-device) ---
    getSession() {
        const data = localStorage.getItem('recall_session');
        return data ? JSON.parse(data) : null;
    },
    saveSession(session) {
        localStorage.setItem('recall_session', JSON.stringify(session));
    },
    clearSession() {
        localStorage.removeItem('recall_session');
    }
};

// =============================================
// AGENT MANAGER
// =============================================
const AgentManager = {
    _cache: [],

    async loadAll() {
        this._cache = await DataStore.getAgents();
        return this._cache;
    },

    getAll() {
        return this._cache;
    },

    getById(id) {
        return this._cache.find(a => a.id === id);
    },

    getByUsername(username) {
        return this._cache.find(a => a.username === username.toLowerCase());
    },

    async create(agentData) {
        const username = agentData.username.trim().toLowerCase();
        
        // Check for duplicate username
        if (this._cache.some(a => a.username === username)) {
            return { success: false, message: 'Username already exists' };
        }

        const newAgent = {
            username,
            display_name: agentData.displayName.trim(),
            password: agentData.password,
            role: agentData.role
        };

        const result = await DataStore.saveAgent(newAgent);
        
        if (!result.success) {
            return { success: false, message: result.error || 'Failed to create agent' };
        }

        // Refresh cache from database to ensure consistency
        await this.loadAll();
        
        return { success: true, agent: result.data };
    },

    async update(id, updates) {
        const index = this._cache.findIndex(a => a.id === id);
        if (index < 0) {
            return { success: false, message: 'Agent not found' };
        }

        const currentAgent = this._cache[index];
        const newUsername = (updates.username || currentAgent.username).toLowerCase();

        // Check for duplicate username (excluding current agent)
        if (newUsername !== currentAgent.username &&
            this._cache.some(a => a.username === newUsername)) {
            return { success: false, message: 'Username already exists' };
        }

        const payload = {
            id,
            username: newUsername,
            display_name: updates.displayName?.trim() || currentAgent.display_name,
            password: updates.password || currentAgent.password,
            role: updates.role || currentAgent.role
        };

        const result = await DataStore.saveAgent(payload);
        
        if (!result.success) {
            return { success: false, message: result.error || 'Failed to update agent' };
        }

        // Refresh cache from database to ensure consistency
        await this.loadAll();
        
        return { success: true, agent: result.data };
    },

    async delete(id) {
        const agent = this._cache.find(a => a.id === id);
        
        if (!agent) {
            return { success: false, message: 'Agent not found' };
        }

        // Prevent deleting the primary admin
        if (agent.username === 'admin') {
            return { success: false, message: 'Cannot delete the primary administrator' };
        }

        // Prevent deleting the last admin
        if (agent.role === 'admin') {
            const adminCount = this._cache.filter(a => a.role === 'admin').length;
            if (adminCount <= 1) {
                return { success: false, message: 'Cannot delete the last administrator' };
            }
        }

        const result = await DataStore.deleteAgent(id);
        
        if (!result.success) {
            return { success: false, message: result.error || 'Failed to delete agent' };
        }

        // Refresh cache from database to ensure consistency
        await this.loadAll();
        
        return { success: true };
    },

    getLoginOptions() {
        return this._cache.map(a => ({
            value: a.username,
            label: `${a.display_name} (${a.role === 'admin' ? 'Admin' : 'Agent'})`
        }));
    }
};

// =============================================
// AUTH
// =============================================
const Auth = {
    login(username, password) {
        const agent = AgentManager.getByUsername(username);
        if (agent && agent.password === password) {
            const session = {
                username: agent.username,
                displayName: agent.display_name,
                role: agent.role,
                agentId: agent.id,
                loginTime: new Date().toISOString()
            };
            DataStore.saveSession(session);
            return { success: true, session };
        }
        return { success: false, message: 'Invalid credentials' };
    },
    
    logout() {
        DataStore.clearSession();
    },
    
    isLoggedIn() {
        return DataStore.getSession() !== null;
    },
    
    getCurrentUser() {
        return DataStore.getSession();
    },
    
    isAdmin() {
        const s = this.getCurrentUser();
        return s && s.role === 'admin';
    }
};

// =============================================
// LEAD MANAGER
// =============================================
const LeadManager = {
    _cache: [],

    async loadAll() {
        this._cache = await DataStore.getLeads();
        return this._cache;
    },

    getAll() {
        return this._cache;
    },

    findByPhone(phone) {
        const normalized = this.normalizePhone(phone);
        return this._cache.find(l => this.normalizePhone(l.phone) === normalized);
    },

    normalizePhone(phone) {
        return phone.replace(/[\s\-\(\)\+\.]/g, '');
    },

    async save(leadData) {
        const existingIndex = this._cache.findIndex(l =>
            this.normalizePhone(l.phone) === this.normalizePhone(leadData.phone)
        );

        if (existingIndex >= 0) {
            const existing = this._cache[existingIndex];
            const newCount = Math.min(existing.follow_up_count + 1, 3);
            const status = newCount >= 3 ? 'completed' : 'active';

            const updated = {
                ...existing,
                lead_type: leadData.leadType || existing.lead_type,
                call_status: leadData.callStatus,
                assigned_agent: leadData.assignedAgent,
                next_follow_up_date: leadData.nextFollowUpDate || null,
                remarks: leadData.remarks || '',
                follow_up_count: newCount,
                status,
                last_updated: new Date().toISOString()
            };

            const result = await DataStore.saveLead(updated);
            
            if (result.success) {
                await this.loadAll();
                return { isNew: false, lead: result.data, isMaxedOut: newCount >= 3 };
            } else {
                return { isNew: false, lead: updated, isMaxedOut: newCount >= 3, error: result.error };
            }
        } else {
            const newLead = {
                phone: leadData.phone,
                lead_type: leadData.leadType,
                call_status: leadData.callStatus,
                assigned_agent: leadData.assignedAgent,
                next_follow_up_date: leadData.nextFollowUpDate || null,
                remarks: leadData.remarks || '',
                follow_up_count: 1,
                status: 'active',
                timestamp: new Date().toISOString(),
                last_updated: new Date().toISOString()
            };

            const result = await DataStore.saveLead(newLead);
            
            if (result.success) {
                await this.loadAll();
                return { isNew: true, lead: result.data, isMaxedOut: false };
            } else {
                return { isNew: true, lead: newLead, isMaxedOut: false, error: result.error };
            }
        }
    },

    async delete(id) {
        const result = await DataStore.deleteLead(id);
        
        if (result.success) {
            await this.loadAll();
        }
        
        return result.success;
    },

    getFiltered(filters = {}) {
        let leads = [...this._cache];
        
        if (filters.search) {
            const s = filters.search.toLowerCase();
            leads = leads.filter(l =>
                l.phone.toLowerCase().includes(s) ||
                (l.assigned_agent && l.assigned_agent.toLowerCase().includes(s)) ||
                (l.remarks && l.remarks.toLowerCase().includes(s))
            );
        }
        
        if (filters.leadType) leads = leads.filter(l => l.lead_type === filters.leadType);
        if (filters.callStatus) leads = leads.filter(l => l.call_status === filters.callStatus);
        if (filters.agent) leads = leads.filter(l => l.assigned_agent === filters.agent);
        if (filters.followUpCount) leads = leads.filter(l => l.follow_up_count === parseInt(filters.followUpCount));
        
        return leads;
    },

    getTodayFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.status === 'active' && l.next_follow_up_date === today);
    },
    
    getUpcomingFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.status === 'active' && l.next_follow_up_date && l.next_follow_up_date > today);
    },
    
    getOverdueFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        return this._cache.filter(l => l.status === 'active' && l.next_follow_up_date && l.next_follow_up_date < today);
    }
};

// =============================================
// ANALYTICS (reads from cache — no DB calls)
// =============================================
const Analytics = {
    getStats() {
        const leads = LeadManager.getAll();
        const today = new Date().toISOString().split('T')[0];
        return {
            total: leads.length,
            answered: leads.filter(l => l.call_status === 'Answered').length,
            declined: leads.filter(l => l.call_status === 'Declined').length,
            noAnswer: leads.filter(l => l.call_status === 'No Answer').length,
            busy: leads.filter(l => l.call_status === 'Busy').length,
            callback: leads.filter(l => l.call_status === 'Call Back Later').length,
            pending: leads.filter(l => l.status === 'active').length,
            completed: leads.filter(l => l.status === 'completed').length,
            todayFollowUps: leads.filter(l => l.next_follow_up_date === today && l.status === 'active').length
        };
    },
    
    getCallStatusDistribution() {
        const leads = LeadManager.getAll();
        return {
            'Answered': { count: leads.filter(l => l.call_status === 'Answered').length, color: 'fill-green' },
            'Declined': { count: leads.filter(l => l.call_status === 'Declined').length, color: 'fill-red' },
            'No Answer': { count: leads.filter(l => l.call_status === 'No Answer').length, color: 'fill-orange' },
            'Busy': { count: leads.filter(l => l.call_status === 'Busy').length, color: 'fill-blue' },
            'Call Back Later': { count: leads.filter(l => l.call_status === 'Call Back Later').length, color: 'fill-purple' }
        };
    },
    
    getLeadTypeDistribution() {
        const leads = LeadManager.getAll();
        return {
            'Social Media Lead': { count: leads.filter(l => l.lead_type === 'Social Media Lead').length, color: 'fill-purple' },
            'Past Inquiry': { count: leads.filter(l => l.lead_type === 'Past Inquiry').length, color: 'fill-blue' },
            'Drop Out': { count: leads.filter(l => l.lead_type === 'Drop Out').length, color: 'fill-orange' },
            'Unpaid Fee': { count: leads.filter(l => l.lead_type === 'Unpaid Fee').length, color: 'fill-red' }
        };
    },
    
    getFollowUpProgression() {
        const leads = LeadManager.getAll();
        return {
            '1 Follow-Up': { count: leads.filter(l => l.follow_up_count === 1).length, color: 'fill-blue' },
            '2 Follow-Ups': { count: leads.filter(l => l.follow_up_count === 2).length, color: 'fill-purple' },
            '3 Follow-Ups (Completed)': { count: leads.filter(l => l.follow_up_count === 3).length, color: 'fill-gray' }
        };
    },
    
    getConversionRates() {
        const stats = this.getStats();
        const total = stats.total || 1;
        return {
            'Answer Rate': ((stats.answered / total) * 100).toFixed(1) + '%',
            'Completion Rate': ((stats.completed / total) * 100).toFixed(1) + '%',
            'Decline Rate': ((stats.declined / total) * 100).toFixed(1) + '%',
            'No Answer Rate': ((stats.noAnswer / total) * 100).toFixed(1) + '%'
        };
    }
};

// =============================================
// CSV EXPORTER
// =============================================
const CSVExporter = {
    export() {
        const leads = LeadManager.getAll();
        if (leads.length === 0) {
            UI.showToast('No data to export', 'error');
            return;
        }
        
        const headers = ['Phone Number','Lead Type','Call Status','Follow-Up Count','Status','Assigned Agent','Next Follow-Up Date','Remarks','Created At','Last Updated'];
        const rows = leads.map(l => [
            l.phone, l.lead_type, l.call_status, l.follow_up_count, l.status,
            l.assigned_agent || '', l.next_follow_up_date || '',
            (l.remarks || '').replace(/"/g, '""'),
            this.fmt(l.timestamp), this.fmt(l.last_updated)
        ]);
        
        let csv = headers.join(',') + '\n';
        rows.forEach(r => {
            csv += r.map(f => `"${f}"`).join(',') + '\n';
        });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recall_export_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        UI.showToast('CSV exported successfully', 'success');
    },
    
    fmt(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
};

// =============================================
// LOADING SCREEN
// =============================================
const LoadingScreen = {
    messages: ['Connecting to cloud...', 'Loading agents...', 'Syncing leads...', 'Preparing workspace...', 'Welcome to ReCall'],
    currentMsg: 0,
    interval: null,
    
    start() {
        const el = document.getElementById('loadingStatus');
        if (!el) return;
        this.interval = setInterval(() => {
            this.currentMsg = (this.currentMsg + 1) % this.messages.length;
            el.style.opacity = '0';
            setTimeout(() => {
                el.textContent = this.messages[this.currentMsg];
                el.style.opacity = '1';
            }, 200);
        }, 600);
    },
    
    finish() {
        if (this.interval) clearInterval(this.interval);
        const screen = document.getElementById('loadingScreen');
        if (screen) {
            screen.classList.add('fade-out');
            setTimeout(() => {
                screen.style.display = 'none';
            }, 600);
        }
    }
};

// =============================================
// REAL-TIME SYNC
// =============================================
function setupRealtimeSync() {
    supabase
        .channel('recall-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async () => {
            await LeadManager.loadAll();
            UI.refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, async () => {
            await AgentManager.loadAll();
            UI.populateLoginDropdown();
            UI.populateAgentFilter();
            UI.populateLeadAgentDropdown();
            if (UI.currentPage === 'admin') UI.renderAgents();
        })
        .subscribe((status) => {
            console.log('Realtime sync status:', status);
        });
}

// =============================================
// UI MODULE
// =============================================
const UI = {
    currentPage: 'dashboard',
    editingLeadId: null,
    editingAgentId: null,

    async init() {
        LoadingScreen.start();
        this.bindEvents();
        this.updateCurrentDate();

        try {
            // Load all cloud data before showing anything
            await AgentManager.loadAll();
            await LeadManager.loadAll();
            this.populateLoginDropdown();

            // Start real-time sync
            setupRealtimeSync();

            // Minimum loading time
            await new Promise(r => setTimeout(r, 2200));

            LoadingScreen.finish();
            setTimeout(() => {
                if (Auth.isLoggedIn()) this.showApp();
                else this.showLogin();
            }, 300);
        } catch (err) {
            console.error('Init error:', err);
            LoadingScreen.finish();
            document.getElementById('loginScreen').classList.remove('hidden');
            this.showToast('Failed to connect to cloud database', 'error');
        }
    },

    bindEvents() {
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        
        document.getElementById('loginUsername').addEventListener('change', () => {
            document.getElementById('loginError').classList.add('hidden');
        });
        
        document.getElementById('loginPassword').addEventListener('input', () => {
            document.getElementById('loginError').classList.add('hidden');
        });

        document.getElementById('passwordToggle').addEventListener('click', () => {
            const pw = document.getElementById('loginPassword');
            const eo = document.querySelector('.eye-open');
            const ec = document.querySelector('.eye-closed');
            if (pw.type === 'password') {
                pw.type = 'text';
                eo.classList.add('hidden');
                ec.classList.remove('hidden');
            } else {
                pw.type = 'password';
                eo.classList.remove('hidden');
                ec.classList.add('hidden');
            }
        });

        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page);
                document.getElementById('sidebar').classList.remove('open');
            });
        });
        
        document.querySelectorAll('.bottom-nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page);
            });
        });
        
        document.getElementById('mobileMenuBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });
        
        document.getElementById('addLeadBtn').addEventListener('click', () => this.openLeadModal());

        document.getElementById('leadForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLeadSubmit();
        });
        
        document.getElementById('leadPhone').addEventListener('input', (e) => this.checkDuplicate(e.target.value));
        
        document.querySelectorAll('#leadModal .modal-close, #leadModal .modal-cancel, #leadModal .modal-overlay').forEach(el => {
            el.addEventListener('click', () => this.closeModal('leadModal'));
        });
        
        document.querySelectorAll('#agentModal .modal-close-agent, #agentModal .modal-overlay').forEach(el => {
            el.addEventListener('click', () => this.closeModal('agentModal'));
        });
        
        document.getElementById('agentForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAgentSubmit();
        });
        
        document.getElementById('addAgentBtn').addEventListener('click', () => this.openAgentModal());

        document.querySelectorAll('[data-admin-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`adminTab${btn.dataset.adminTab.charAt(0).toUpperCase() + btn.dataset.adminTab.slice(1)}`).classList.add('active');
            });
        });

        document.getElementById('searchInput').addEventListener('input', () => this.renderLeads());
        document.getElementById('filterType').addEventListener('change', () => this.renderLeads());
        document.getElementById('filterStatus').addEventListener('change', () => this.renderLeads());
        document.getElementById('filterAgent').addEventListener('change', () => this.renderLeads());

        document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderFollowUps(btn.dataset.tab);
            });
        });

        document.getElementById('exportCsvBtn').addEventListener('click', () => CSVExporter.export());
        
        document.getElementById('clearAllBtn').addEventListener('click', () => {
            this.showConfirm('Clear All Data', 'This will permanently delete all leads from the cloud database.', async () => {
                const leads = LeadManager.getAll();
                for (const lead of leads) {
                    await DataStore.deleteLead(lead.id);
                }
                await LeadManager.loadAll();
                this.refreshAll();
                this.showToast('All data cleared', 'success');
            });
        });
    },

    populateLoginDropdown() {
        const select = document.getElementById('loginUsername');
        const options = AgentManager.getLoginOptions();
        select.innerHTML = '<option value="" disabled selected>Select a user</option>';
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            select.appendChild(o);
        });
    },

    showLogin() {
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
        this.populateLoginDropdown();
    },

    showApp() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        const user = Auth.getCurrentUser();
        this.updateUserInfo(user);
        this.toggleAdminFeatures(user.role === 'admin');
        this.populateAgentFilter();
        this.populateLeadAgentDropdown();
        this.navigateTo('dashboard');
    },

    updateUserInfo(user) {
        document.getElementById('sidebarAvatar').textContent = user.displayName.charAt(0);
        document.getElementById('sidebarName').textContent = user.displayName;
        document.getElementById('sidebarRole').textContent = user.role === 'admin' ? 'Administrator' : 'Sales Agent';
    },

    toggleAdminFeatures(show) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !show));
    },

    handleLogin() {
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        const errorText = document.getElementById('loginErrorText');
        const submitBtn = document.getElementById('loginSubmitBtn');

        if (!username) {
            errorText.textContent = 'Please select an account';
            errorEl.classList.remove('hidden');
            return;
        }
        
        if (!password) {
            errorText.textContent = 'Please enter your password';
            errorEl.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.querySelector('.btn-text').textContent = 'Signing in...';

        setTimeout(() => {
            const result = Auth.login(username, password);
            if (result.success) {
                errorEl.classList.add('hidden');
                document.getElementById('loginForm').reset();
                this.showApp();
            } else {
                errorText.textContent = result.message;
                errorEl.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.querySelector('.btn-text').textContent = 'Sign In';
            }
        }, 400);
    },

    handleLogout() {
        Auth.logout();
        this.showLogin();
        document.getElementById('loginPassword').value = '';
        document.getElementById('loginError').classList.add('hidden');
    },

    navigateTo(page) {
        this.currentPage = page;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.bottom-nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll(`[data-page="${page}"]`).forEach(l => l.classList.add('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.classList.add('active');
        const titles = {
            dashboard: 'Dashboard',
            leads: 'Leads',
            followups: 'Follow-Ups',
            analytics: 'Analytics',
            admin: 'Admin Panel'
        };
        document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
        this.renderPage(page);
    },

    renderPage(page) {
        switch (page) {
            case 'dashboard': this.renderDashboard(); break;
            case 'leads': this.renderLeads(); break;
            case 'followups': this.renderFollowUps('today'); break;
            case 'analytics': this.renderAnalytics(); break;
            case 'admin': this.renderAdmin(); this.renderAgents(); break;
        }
    },

    refreshAll() {
        this.renderPage(this.currentPage);
        this.populateAgentFilter();
        this.populateLeadAgentDropdown();
    },

    renderDashboard() {
        const stats = Analytics.getStats();
        this.animateCounter('statTotal', stats.total);
        this.animateCounter('statAnswered', stats.answered);
        this.animateCounter('statDeclined', stats.declined);
        this.animateCounter('statNoAnswer', stats.noAnswer);
        this.animateCounter('statPending', stats.pending);
        this.animateCounter('statCompleted', stats.completed);
        this.animateCounter('statToday', stats.todayFollowUps);

        const todayEl = document.getElementById('todayFollowUps');
        const todayLeads = LeadManager.getTodayFollowUps();
        todayEl.innerHTML = todayLeads.length === 0
            ? '<div class="empty-state"><p>No follow-ups scheduled for today.</p></div>'
            : todayLeads.map(l => `
                <div class="today-item">
                    <div>
                        <div class="today-phone">${this.escapeHtml(l.phone)}</div>
                        <div class="today-type">${this.escapeHtml(l.lead_type)} · Follow-up ${l.follow_up_count}/3</div>
                    </div>
                    <button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Update</button>
                </div>
            `).join('');

        const actEl = document.getElementById('recentActivity');
        const recent = LeadManager.getAll().slice(0, 8);
        actEl.innerHTML = recent.length === 0
            ? '<div class="empty-state"><p>No recent activity.</p></div>'
            : recent.map(l => `
                <div class="activity-item">
                    <div class="activity-dot ${this.getStatusColor(l.call_status)}"></div>
                    <div class="activity-content">
                        <div class="activity-text">
                            <strong>${this.escapeHtml(l.phone)}</strong> — ${this.escapeHtml(l.call_status)}
                        </div>
                        <div class="activity-time">${this.timeAgo(l.last_updated)} · ${this.escapeHtml(l.assigned_agent || 'Unknown')}</div>
                    </div>
                </div>
            `).join('');
    },

    animateCounter(id, target) {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = parseInt(el.textContent) || 0;
        if (cur === target) return;
        const steps = 20, inc = (target - cur) / steps;
        let s = 0;
        const t = setInterval(() => {
            s++;
            if (s >= steps) {
                el.textContent = target;
                clearInterval(t);
            } else {
                el.textContent = Math.round(cur + inc * s);
            }
        }, 20);
    },

    renderLeads() {
        const filters = {
            search: document.getElementById('searchInput').value,
            leadType: document.getElementById('filterType').value,
            callStatus: document.getElementById('filterStatus').value,
            agent: document.getElementById('filterAgent').value
        };
        const leads = LeadManager.getFiltered(filters);
        const c = document.getElementById('leadsList');
        c.innerHTML = leads.length === 0
            ? '<div class="empty-state"><p>No leads match your filters.</p></div>'
            : leads.map(l => this.renderLeadItem(l)).join('');
    },

    renderLeadItem(l) {
        const done = l.status === 'completed';
        return `
            <div class="lead-item ${done ? 'completed' : ''}">
                <div class="lead-item-info">
                    <div class="lead-item-header">
                        <span class="lead-phone">${this.escapeHtml(l.phone)}</span>
                        <span class="lead-type-badge ${this.getTypeBadgeClass(l.lead_type)}">${this.escapeHtml(l.lead_type)}</span>
                        <span class="follow-up-counter ${l.follow_up_count >= 3 ? 'max' : ''}">${l.follow_up_count}/3</span>
                    </div>
                    <div class="lead-meta">
                        <span class="lead-meta-item">
                            <span class="status-dot ${this.getStatusDotClass(l.call_status)}"></span>
                            ${this.escapeHtml(l.call_status)}
                        </span>
                        <span class="lead-meta-item">Agent: ${this.escapeHtml(l.assigned_agent || 'Unassigned')}</span>
                        ${l.next_follow_up_date ? `<span class="lead-meta-item">Follow-up: ${l.next_follow_up_date}</span>` : ''}
                        <span class="lead-meta-item">${this.timeAgo(l.last_updated)}</span>
                    </div>
                    ${l.remarks ? `<div class="lead-remarks">"${this.escapeHtml(l.remarks)}"</div>` : ''}
                </div>
                <div class="lead-actions">
                    ${!done ? `<button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Update</button>` : ''}
                    ${Auth.isAdmin() ? `<button class="btn btn-danger btn-xs" onclick="UI.deleteLead('${l.id}')">Delete</button>` : ''}
                </div>
            </div>
        `;
    },

    renderFollowUps(tab) {
        let leads, msg;
        switch (tab) {
            case 'today':
                leads = LeadManager.getTodayFollowUps();
                msg = 'No follow-ups today.';
                break;
            case 'upcoming':
                leads = LeadManager.getUpcomingFollowUps();
                msg = 'No upcoming follow-ups.';
                break;
            case 'overdue':
                leads = LeadManager.getOverdueFollowUps();
                msg = 'No overdue follow-ups.';
                break;
            default:
                leads = [];
        }
        const c = document.getElementById('followupList');
        c.innerHTML = leads.length === 0
            ? `<div class="empty-state"><p>${msg}</p></div>`
            : leads.map(l => `
                <div class="lead-item">
                    <div class="lead-item-info">
                        <div class="lead-item-header">
                            <span class="lead-phone">${this.escapeHtml(l.phone)}</span>
                            <span class="lead-type-badge ${this.getTypeBadgeClass(l.lead_type)}">${this.escapeHtml(l.lead_type)}</span>
                            <span class="follow-up-counter">${l.follow_up_count}/3</span>
                        </div>
                        <div class="lead-meta">
                            <span class="lead-meta-item">
                                <span class="status-dot ${this.getStatusDotClass(l.call_status)}"></span>
                                ${this.escapeHtml(l.call_status)}
                            </span>
                            <span class="lead-meta-item">Agent: ${this.escapeHtml(l.assigned_agent || 'Unassigned')}</span>
                            <span class="lead-meta-item">Due: ${l.next_follow_up_date}</span>
                        </div>
                    </div>
                    <div class="lead-actions">
                        <button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Update</button>
                    </div>
                </div>
            `).join('');
    },

    renderAnalytics() {
        document.getElementById('chartCallStatus').innerHTML = this.renderBarChart(Analytics.getCallStatusDistribution());
        document.getElementById('chartLeadType').innerHTML = this.renderBarChart(Analytics.getLeadTypeDistribution());
        document.getElementById('chartFollowUp').innerHTML = this.renderBarChart(Analytics.getFollowUpProgression());
        const cd = Analytics.getConversionRates();
        const cc = {
            'Answer Rate': 'var(--status-green)',
            'Completion Rate': 'var(--accent-blue)',
            'Decline Rate': 'var(--status-red)',
            'No Answer Rate': 'var(--status-orange)'
        };
        document.getElementById('conversionRates').innerHTML = Object.entries(cd).map(([k, v]) => `
            <div class="conversion-item">
                <span class="conversion-label">${k}</span>
                <span class="conversion-value" style="color:${cc[k] || 'var(--text-primary)'}">${v}</span>
            </div>
        `).join('');
    },

    renderBarChart(data) {
        const max = Math.max(...Object.values(data).map(d => d.count), 1);
        return Object.entries(data).map(([k, { count, color }]) => `
            <div class="chart-bar-group">
                <div class="chart-bar-label">
                    <span>${k}</span>
                    <span>${count}</span>
                </div>
                <div class="chart-bar-track">
                    <div class="chart-bar-fill ${color}" style="width:${(count / max) * 100}%"></div>
                </div>
            </div>
        `).join('');
    },

    renderAdmin() {
        const leads = LeadManager.getAll();
        document.getElementById('adminTotalLeads').textContent = leads.length;
        document.getElementById('adminActiveLeads').textContent = leads.filter(l => l.status === 'active').length;
        document.getElementById('adminCompletedLeads').textContent = leads.filter(l => l.status === 'completed').length;
        const tc = document.getElementById('adminTable');
        tc.innerHTML = leads.length === 0
            ? '<div class="empty-state"><p>No leads in the database.</p></div>'
            : `
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Phone</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Follow-Ups</th>
                            <th>Agent</th>
                            <th>Last Updated</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${leads.map(l => `
                            <tr>
                                <td><strong>${this.escapeHtml(l.phone)}</strong></td>
                                <td>${this.escapeHtml(l.lead_type)}</td>
                                <td>${this.escapeHtml(l.call_status)}</td>
                                <td>${l.follow_up_count}/3</td>
                                <td>${this.escapeHtml(l.assigned_agent || '-')}</td>
                                <td>${this.timeAgo(l.last_updated)}</td>
                                <td class="admin-actions">
                                    <button class="btn btn-primary btn-xs" onclick="UI.openLeadModal('${l.id}')">Edit</button>
                                    <button class="btn btn-danger btn-xs" onclick="UI.deleteLead('${l.id}')">Delete</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
    },

    renderAgents() {
        const agents = AgentManager.getAll();
        const c = document.getElementById('agentsList');
        
        if (agents.length === 0) {
            c.innerHTML = '<div class="empty-state"><p>No agents found.</p></div>';
            return;
        }
        
        const leads = LeadManager.getAll();
        const cu = Auth.getCurrentUser();
        
        c.innerHTML = agents.map(a => {
            const lc = leads.filter(l => l.assigned_agent === a.display_name).length;
            const self = cu && cu.agentId === a.id;
            const canDel = !self && a.username !== 'admin';
            
            return `
                <div class="agent-card">
                    <div class="agent-card-header">
                        <div class="agent-avatar ${a.role === 'admin' ? 'admin' : ''}">${a.display_name.charAt(0)}</div>
                        <div class="agent-info">
                            <div class="agent-name">
                                ${this.escapeHtml(a.display_name)}
                                ${self ? ' <small style="color:var(--text-muted);font-weight:400">(you)</small>' : ''}
                            </div>
                            <div class="agent-username">@${this.escapeHtml(a.username)}</div>
                        </div>
                    </div>
                    <div>
                        <span class="agent-role-badge role-${a.role}">
                            ${a.role === 'admin' ? 'Administrator' : 'Sales Agent'}
                        </span>
                    </div>
                    <div class="agent-meta">
                        <span>📞 ${lc} leads</span>
                    </div>
                    <div class="agent-actions">
                        <button class="btn btn-primary btn-xs" onclick="UI.openAgentModal('${a.id}')">Edit</button>
                        ${canDel
                            ? `<button class="btn btn-danger btn-xs" onclick="UI.deleteAgent('${a.id}')">Delete</button>`
                            : `<button class="btn btn-ghost btn-xs" disabled style="opacity:0.4;cursor:not-allowed">${a.username === 'admin' ? 'Protected' : 'Self'}</button>`
                        }
                    </div>
                </div>
            `;
        }).join('');
    },

    openAgentModal(agentId = null) {
        this.editingAgentId = agentId;
        const form = document.getElementById('agentForm');
        const title = document.getElementById('agentModalTitle');
        const sb = document.getElementById('agentSubmitBtn');
        const ui = document.getElementById('agentUsername');
        
        form.reset();
        
        if (agentId) {
            const a = AgentManager.getById(agentId);
            if (a) {
                title.textContent = 'Edit Agent';
                sb.textContent = 'Update Agent';
                document.getElementById('agentDisplayName').value = a.display_name;
                ui.value = a.username;
                document.getElementById('agentRole').value = a.role;
                document.getElementById('agentPassword').value = a.password;
                ui.readOnly = a.username === 'admin';
                ui.style.opacity = a.username === 'admin' ? '0.6' : '1';
            }
        } else {
            title.textContent = 'Add New Agent';
            sb.textContent = 'Save Agent';
            ui.readOnly = false;
            ui.style.opacity = '1';
        }
        
        document.getElementById('agentModal').classList.remove('hidden');
    },

    async handleAgentSubmit() {
        const dn = document.getElementById('agentDisplayName').value.trim();
        const un = document.getElementById('agentUsername').value.trim();
        const ro = document.getElementById('agentRole').value;
        const pw = document.getElementById('agentPassword').value;
        
        if (!dn || !un || !pw) {
            this.showToast('Fill in all fields', 'error');
            return;
        }
        
        if (pw.length < 4) {
            this.showToast('Password min 4 chars', 'error');
            return;
        }
        
        let result;
        if (this.editingAgentId) {
            result = await AgentManager.update(this.editingAgentId, {
                displayName: dn,
                username: un,
                role: ro,
                password: pw
            });
        } else {
            result = await AgentManager.create({
                displayName: dn,
                username: un,
                role: ro,
                password: pw
            });
        }
        
        if (result.success) {
            this.showToast(this.editingAgentId ? 'Agent updated' : 'Agent added', 'success');
            this.closeModal('agentModal');
            
            // Update session if editing self
            const cu = Auth.getCurrentUser();
            if (this.editingAgentId && cu && cu.agentId === this.editingAgentId) {
                cu.displayName = dn;
                cu.role = ro;
                DataStore.saveSession(cu);
                this.updateUserInfo(cu);
                this.toggleAdminFeatures(ro === 'admin');
            }
            
            this.renderAgents();
            this.populateLoginDropdown();
            this.populateAgentFilter();
            this.populateLeadAgentDropdown();
        } else {
            this.showToast(result.message, 'error');
        }
    },

    deleteAgent(id) {
        const a = AgentManager.getById(id);
        if (!a) return;
        
        this.showConfirm(
            'Delete Agent',
            `Delete "${a.display_name}" (@${a.username})?`,
            async () => {
                const r = await AgentManager.delete(id);
                if (r.success) {
                    this.showToast('Agent deleted', 'success');
                    this.renderAgents();
                    this.populateLoginDropdown();
                    this.populateAgentFilter();
                    this.populateLeadAgentDropdown();
                } else {
                    this.showToast(r.message, 'error');
                }
            }
        );
    },

    openLeadModal(leadId = null) {
        this.editingLeadId = leadId;
        const form = document.getElementById('leadForm');
        const title = document.getElementById('modalTitle');
        const sb = document.getElementById('leadSubmitBtn');
        const pi = document.getElementById('leadPhone');
        const fc = document.getElementById('leadFollowUpCount');
        const dm = document.getElementById('phoneDuplicateMsg');
        
        form.reset();
        dm.classList.add('hidden');
        this.populateLeadAgentDropdown();
        
        if (leadId) {
            const l = LeadManager.getAll().find(x => x.id === leadId);
            if (l) {
                title.textContent = 'Update Lead';
                sb.textContent = 'Update Lead';
                pi.value = l.phone;
                pi.readOnly = true;
                document.getElementById('leadType').value = l.lead_type;
                document.getElementById('leadCallStatus').value = l.call_status;
                document.getElementById('leadAgent').value = l.assigned_agent || '';
                document.getElementById('leadFollowUpDate').value = l.next_follow_up_date || '';
                document.getElementById('leadRemarks').value = l.remarks || '';
                fc.value = `${l.follow_up_count} / 3`;
            }
        } else {
            title.textContent = 'Add New Lead';
            sb.textContent = 'Save Lead';
            pi.readOnly = false;
            fc.value = '1 / 3';
            const u = Auth.getCurrentUser();
            if (u) document.getElementById('leadAgent').value = u.displayName;
        }
        
        document.getElementById('leadModal').classList.remove('hidden');
    },

    async handleLeadSubmit() {
        const phone = document.getElementById('leadPhone').value.trim();
        const lt = document.getElementById('leadType').value;
        const cs = document.getElementById('leadCallStatus').value;
        const aa = document.getElementById('leadAgent').value;
        const fd = document.getElementById('leadFollowUpDate').value;
        const rm = document.getElementById('leadRemarks').value.trim();
        
        if (!phone || !lt || !cs || !aa) {
            this.showToast('Fill in all required fields', 'error');
            return;
        }
        
        const result = await LeadManager.save({
            phone,
            leadType: lt,
            callStatus: cs,
            assignedAgent: aa,
            nextFollowUpDate: fd,
            remarks: rm
        });
        
        if (result.error) {
            this.showToast(`Error: ${result.error}`, 'error');
            return;
        }
        
        if (result.isMaxedOut) {
            this.showToast('Lead completed — max 3 follow-ups', 'success');
        } else if (result.isNew) {
            this.showToast('New lead created', 'success');
        } else {
            this.showToast(`Lead updated — follow-up ${result.lead.follow_up_count}/3`, 'success');
        }
        
        this.closeModal('leadModal');
        this.refreshAll();
    },

    checkDuplicate(phone) {
        const dm = document.getElementById('phoneDuplicateMsg');
        if (phone.length > 5) {
            const ex = LeadManager.findByPhone(phone);
            if (ex) {
                dm.classList.remove('hidden');
                dm.textContent = `Existing lead (${ex.follow_up_count}/3) — will update`;
            } else {
                dm.classList.add('hidden');
            }
        } else {
            dm.classList.add('hidden');
        }
    },

    async deleteLead(id) {
        this.showConfirm('Delete Lead', 'Permanently delete this lead?', async () => {
            await LeadManager.delete(id);
            this.refreshAll();
            this.showToast('Lead deleted', 'success');
        });
    },

    closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    },

    showConfirm(title, msg, onConfirm) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = msg;
        document.getElementById('confirmModal').classList.remove('hidden');
        
        const ok = document.getElementById('confirmOk');
        const cn = document.getElementById('confirmCancel');
        const ov = document.querySelector('#confirmModal .modal-overlay');
        
        const nok = ok.cloneNode(true);
        ok.parentNode.replaceChild(nok, ok);
        const ncn = cn.cloneNode(true);
        cn.parentNode.replaceChild(ncn, cn);
        
        nok.addEventListener('click', () => {
            onConfirm();
            this.closeModal('confirmModal');
        });
        
        ncn.addEventListener('click', () => this.closeModal('confirmModal'));
        
        ov.addEventListener('click', () => this.closeModal('confirmModal'), { once: true });
    },

    populateAgentFilter() {
        const leads = LeadManager.getAll();
        const agents = [...new Set(leads.map(l => l.assigned_agent).filter(Boolean))];
        const s = document.getElementById('filterAgent');
        s.innerHTML = '<option value="">All Agents</option>';
        agents.forEach(a => {
            const o = document.createElement('option');
            o.value = a;
            o.textContent = a;
            s.appendChild(o);
        });
    },

    populateLeadAgentDropdown() {
        const s = document.getElementById('leadAgent');
        s.innerHTML = '<option value="">Select Agent</option>';
        AgentManager.getAll().forEach(a => {
            const o = document.createElement('option');
            o.value = a.display_name;
            o.textContent = a.display_name;
            s.appendChild(o);
        });
    },

    updateCurrentDate() {
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },

    showToast(msg, type = 'success') {
        const t = document.getElementById('toast');
        document.getElementById('toastMessage').textContent = msg;
        t.className = `toast ${type}`;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3000);
    },

    timeAgo(iso) {
        if (!iso) return '';
        const s = Math.floor((new Date() - new Date(iso)) / 1000);
        if (s < 60) return 'Just now';
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    getStatusDotClass(s) {
        return {
            'Answered': 'status-answered',
            'Declined': 'status-declined',
            'No Answer': 'status-noanswer',
            'Busy': 'status-busy',
            'Call Back Later': 'status-callback'
        }[s] || 'status-answered';
    },
    
    getStatusColor(s) {
        return this.getStatusDotClass(s);
    },
    
    getTypeBadgeClass(t) {
        return {
            'Social Media Lead': 'badge-social',
            'Past Inquiry': 'badge-past',
            'Drop Out': 'badge-drop',
            'Unpaid Fee': 'badge-unpaid'
        }[t] || 'badge-social';
    },
    
    escapeHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
};

// =============================================
// INITIALIZE
// =============================================
document.addEventListener('DOMContentLoaded', () => UI.init());
