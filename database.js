// PostgreSQL Database Manager
// Handles all database operations for offers and transactions via API calls

class DatabaseManager {
    constructor() {
        this.initialized = false;
        this.baseUrl = window.location.origin;
        this.currentPersonId = localStorage.getItem('currentPersonId') || null;
    }

    setCurrentPerson(personId) {
        this.currentPersonId = personId;
        localStorage.setItem('currentPersonId', personId);
    }

    getCurrentPerson() {
        return this.currentPersonId;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Test connection to the API
            const response = await fetch(`${this.baseUrl}/api/initialize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to connect to database API');
            }

            this.initialized = true;
            console.log('Database API connection established');

            // Auto-trigger app initialization (no user prompts needed)
            if (window.tracker) {
                await window.tracker.onDatabaseReady();
            } else {
                console.error('window.tracker not found');
            }

        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    // People methods
    async getPeople() {
        try {
            const response = await fetch(`${this.baseUrl}/api/people`);
            if (!response.ok) {
                throw new Error('Failed to fetch people');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching people:', error);
            return [];
        }
    }

    async addPerson(name) {
        try {
            const response = await fetch(`${this.baseUrl}/api/people`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name })
            });

            if (!response.ok) {
                throw new Error('Failed to add person');
            }

            return await response.json();
        } catch (error) {
            console.error('Error adding person:', error);
            throw error;
        }
    }

    async updatePerson(id, name) {
        try {
            const response = await fetch(`${this.baseUrl}/api/people/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name })
            });

            if (!response.ok) {
                throw new Error('Failed to update person');
            }

            return await response.json();
        } catch (error) {
            console.error('Error updating person:', error);
            throw error;
        }
    }

    async deletePerson(id) {
        try {
            const response = await fetch(`${this.baseUrl}/api/people/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete person');
            }

            return await response.json();
        } catch (error) {
            console.error('Error deleting person:', error);
            throw error;
        }
    }

    // Offers methods
    async getOffers() {
        try {
            let url = `${this.baseUrl}/api/offers`;
            if (this.currentPersonId) {
                url += `?personId=${this.currentPersonId}`;
            }
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch offers');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching offers:', error);
            return [];
        }
    }

    async addOffer(offerData) {
        try {
            const response = await fetch(`${this.baseUrl}/api/offers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(offerData)
            });

            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || 'Failed to add offer');
            }

            return await response.json();
        } catch (error) {
            console.error('Error adding offer:', error);
            throw error;
        }
    }

    async checkOfferDuplicate(fingerprint) {
        const params = new URLSearchParams({ personId: this.currentPersonId, fingerprint });
        const response = await fetch(`${this.baseUrl}/api/offers/check-duplicate?${params}`);
        if (!response.ok) throw new Error('Failed to check for duplicate offer');
        return response.json();
    }

    async updateOffer(id, offerData) {
        try {
            const response = await fetch(`${this.baseUrl}/api/offers/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(offerData)
            });

            if (!response.ok) {
                throw new Error('Failed to update offer');
            }

            return await response.json();
        } catch (error) {
            console.error('Error updating offer:', error);
            throw error;
        }
    }

    async deleteOffer(id) {
        try {
            const response = await fetch(`${this.baseUrl}/api/offers/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete offer');
            }

            return await response.json();
        } catch (error) {
            console.error('Error deleting offer:', error);
            throw error;
        }
    }

    async getOffer(id) {
        try {
            const response = await fetch(`${this.baseUrl}/api/offers/${id}`);
            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error('Failed to fetch offer');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching offer:', error);
            return null;
        }
    }

    async addOfferCredit(offerId, credit) {
        const response = await fetch(`${this.baseUrl}/api/offers/${offerId}/credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credit)
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to record credit');
        return response.json();
    }

    async deleteOfferCredit(offerId, creditId) {
        const response = await fetch(`${this.baseUrl}/api/offers/${offerId}/credits/${creditId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete credit');
        return response.json();
    }

    // Transactions methods
    async getTransactions() {
        try {
            let url = `${this.baseUrl}/api/transactions`;
            if (this.currentPersonId) {
                url += `?personId=${this.currentPersonId}`;
            }
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch transactions');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching transactions:', error);
            return [];
        }
    }

    async addTransaction(transactionData) {
        try {
            const response = await fetch(`${this.baseUrl}/api/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(transactionData)
            });

            if (!response.ok) {
                throw new Error('Failed to add transaction');
            }

            return await response.json();
        } catch (error) {
            console.error('Error adding transaction:', error);
            throw error;
        }
    }

    async updateTransaction(id, transactionData) {
        try {
            const response = await fetch(`${this.baseUrl}/api/transactions/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(transactionData)
            });

            if (!response.ok) {
                throw new Error('Failed to update transaction');
            }

            return await response.json();
        } catch (error) {
            console.error('Error updating transaction:', error);
            throw error;
        }
    }

    async deleteTransaction(id) {
        try {
            const response = await fetch(`${this.baseUrl}/api/transactions/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete transaction');
            }

            return await response.json();
        } catch (error) {
            console.error('Error deleting transaction:', error);
            throw error;
        }
    }

    async previewTransactionImport(transactions) {
        const response = await fetch(`${this.baseUrl}/api/transaction-imports/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: this.currentPersonId, transactions })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to preview import');
        return response.json();
    }

    async confirmTransactionImport(transactions, importMetadata = {}, accountEvents = []) {
        const response = await fetch(`${this.baseUrl}/api/transaction-imports/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: this.currentPersonId, transactions, importMetadata, accountEvents })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to import transactions');
        return response.json();
    }

    async getPlaidReview() {
        if (!this.currentPersonId) return { transactions: [] };
        const response = await fetch(`${this.baseUrl}/api/plaid/review?personId=${encodeURIComponent(this.currentPersonId)}`);
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load Plaid review');
        return response.json();
    }

    async createPlaidLinkToken() {
        const response = await fetch(`${this.baseUrl}/api/plaid/link-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to start Citi connection');
        return response.json();
    }

    async createPlaidUpdateLinkToken(connectionId) {
        const response = await fetch(`${this.baseUrl}/api/plaid/connections/${connectionId}/update-link-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to reconnect Citi');
        return response.json();
    }

    async exchangePlaidToken(publicToken) {
        const response = await fetch(`${this.baseUrl}/api/plaid/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId, publicToken }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to finish Citi connection');
        return response.json();
    }

    async selectPlaidAccount(connectionId, accountId) {
        const response = await fetch(`${this.baseUrl}/api/plaid/connections/${connectionId}/account`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId, accountId }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to select Citi account');
        return response.json();
    }

    async getPlaidStatus() {
        if (!this.currentPersonId) return [];
        const response = await fetch(`${this.baseUrl}/api/plaid/status?personId=${encodeURIComponent(this.currentPersonId)}`);
        if (response.status === 503) return [];
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load Citi connection');
        return response.json();
    }

    async syncPlaidConnection(connectionId) {
        const response = await fetch(`${this.baseUrl}/api/plaid/connections/${connectionId}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to sync Citi');
        return response.json();
    }

    async disconnectPlaidConnection(connectionId) {
        const response = await fetch(`${this.baseUrl}/api/plaid/connections/${connectionId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: this.currentPersonId }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to disconnect Citi');
        return response.json();
    }

    async getMerchantRules() {
        const response = await fetch(`${this.baseUrl}/api/merchant-rules`);
        if (!response.ok) throw new Error('Failed to load merchant rules');
        return response.json();
    }

    async deleteMerchantRule(id) {
        const response = await fetch(`${this.baseUrl}/api/merchant-rules/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete merchant rule');
        return response.json();
    }

    async getAccountEvents() {
        const response = await fetch(`${this.baseUrl}/api/account-events?personId=${encodeURIComponent(this.currentPersonId)}`);
        if (!response.ok) throw new Error('Failed to load account events');
        return response.json();
    }

    async autoMatchAccountEvents() {
        if (!this.currentPersonId) return { matched: 0, matches: [] };
        const response = await fetch(`${this.baseUrl}/api/account-events/auto-match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: this.currentPersonId })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to auto-match credits');
        return response.json();
    }

    async assignAccountEvent(eventId, offerId) {
        const response = await fetch(`${this.baseUrl}/api/account-events/${eventId}/assign-offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: this.currentPersonId, offerId })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to assign account event');
        return response.json();
    }

    async getM365Status() {
        const response = await fetch(`${this.baseUrl}/api/m365/status`);
        if (!response.ok) throw new Error('Failed to load Microsoft 365 status');
        return response.json();
    }

    async testM365Connection() {
        const response = await fetch(`${this.baseUrl}/api/m365/test`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Microsoft 365 connection test failed');
        return result;
    }

    async syncM365() {
        const response = await fetch(`${this.baseUrl}/api/m365/sync`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Microsoft 365 synchronization failed');
        return result;
    }

    async getM365Messages() {
        const suffix = this.currentPersonId ? `?personId=${encodeURIComponent(this.currentPersonId)}` : '';
        const response = await fetch(`${this.baseUrl}/api/m365/messages${suffix}`);
        if (!response.ok) throw new Error('Failed to load Microsoft 365 messages');
        return response.json();
    }

    async updateM365Message(id, processingStatus, linkedOfferId = null) {
        const response = await fetch(`${this.baseUrl}/api/m365/messages/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processingStatus, linkedOfferId })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to update Microsoft 365 message');
        return result;
    }

    // Get unique merchants for autocomplete
    async getUniqueMerchants() {
        try {
            const response = await fetch(`${this.baseUrl}/api/merchants`);
            if (!response.ok) {
                throw new Error('Failed to fetch merchants');
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching merchants:', error);
            return [];
        }
    }

    // Get most common categories for a merchant
    async getMostCommonCategoryForMerchant(merchant) {
        try {
            const response = await fetch(`${this.baseUrl}/api/merchants/${encodeURIComponent(merchant)}/category`);
            if (!response.ok) {
                throw new Error('Failed to fetch merchant categories');
            }
            const result = await response.json();
            return result.categories || [];
        } catch (error) {
            console.error('Error fetching merchant categories:', error);
            return [];
        }
    }

    // Legacy methods that are no longer needed but kept for compatibility
    showDatabaseSetupModal() {
        // No longer needed - auto-connects to PostgreSQL
        console.log('Database setup modal not needed for PostgreSQL version');
    }

    hideDatabaseSetupModal() {
        // No longer needed
    }

    saveDatabase() {
        // No longer needed - data is automatically saved to PostgreSQL
        console.log('Data automatically saved to PostgreSQL');
    }

    async openExistingDatabase() {
        // No longer needed
        console.log('Opening existing database not needed for PostgreSQL version');
    }

    async createNewDatabase() {
        // No longer needed
        console.log('Creating new database not needed for PostgreSQL version');
    }

    exportDatabase() {
        console.log('Database export feature could be implemented as an API endpoint');
        // Could implement this as a feature to download JSON backup
    }

    async importDatabase(file) {
        console.log('Database import feature could be implemented as an API endpoint');
        // Could implement this as a feature to upload JSON backup
        throw new Error('Import feature not yet implemented for PostgreSQL version');
    }

    createTables() {
        // Tables are created by the migration script
        console.log('Tables are managed by the server migration script');
    }

    initializeWithPersonalData() {
        // Initial data is inserted by the migration script
        console.log('Initial data is managed by the server migration script');
    }

    async loadFromFileHandle() {
        // No longer needed
    }

    async saveToFileHandle() {
        // No longer needed
    }
}
