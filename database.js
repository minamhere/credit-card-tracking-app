// PostgreSQL Database Manager
// Handles all database operations for offers and transactions via API calls

class DatabaseManager {
    constructor() {
        this.initialized = false;
        this.baseUrl = window.location.origin;
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

    // Offers methods
    async getOffers() {
        try {
            const response = await fetch(`${this.baseUrl}/api/offers`);
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
                throw new Error('Failed to add offer');
            }

            return await response.json();
        } catch (error) {
            console.error('Error adding offer:', error);
            throw error;
        }
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

    // Transactions methods
    async getTransactions() {
        try {
            const response = await fetch(`${this.baseUrl}/api/transactions`);
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

    // Get most common category for a merchant
    async getMostCommonCategoryForMerchant(merchant) {
        try {
            const response = await fetch(`${this.baseUrl}/api/merchants/${encodeURIComponent(merchant)}/category`);
            if (!response.ok) {
                throw new Error('Failed to fetch merchant category');
            }
            const result = await response.json();
            return result.category || '';
        } catch (error) {
            console.error('Error fetching merchant category:', error);
            return '';
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