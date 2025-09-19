class OfferTracker {
    constructor() {
        this.dataManager = new DataManager();
        this.currentEditingOffer = null;
        this.personalConfig = this.dataManager.getPersonalConfig();
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupTabs();

        // Initialize database (will show modal)
        await this.dataManager.initialize();
    }

    async onDatabaseReady() {
        console.log('onDatabaseReady called');
        // Called when database is ready
        try {
            console.log('Rendering recommendations...');
            await this.renderRecommendations();
            console.log('Rendering dashboard...');
            await this.renderDashboard();
            console.log('Rendering transactions...');
            await this.renderTransactions();
            console.log('Rendering offers...');
            await this.renderOffers();
            console.log('All rendering complete');
        } catch (error) {
            console.error('Error in onDatabaseReady:', error);
        }
    }

    setupEventListeners() {
        document.getElementById('transaction-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTransaction();
        });

        document.getElementById('offer-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveOffer();
        });

        document.getElementById('add-offer-btn').addEventListener('click', () => {
            this.showOfferForm();
        });

        document.getElementById('cancel-offer').addEventListener('click', () => {
            this.hideOfferForm();
        });

        document.getElementById('transaction-date').valueAsDate = new Date();

        // Set up transaction edit modal event listeners
        document.getElementById('transaction-edit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateTransaction();
        });

        document.getElementById('cancel-edit-transaction').addEventListener('click', () => {
            this.hideTransactionEditModal();
        });

        // Set up merchant autocomplete
        this.setupMerchantAutocomplete();
        this.setupEditMerchantAutocomplete();
    }

    async setupMerchantAutocomplete() {
        const merchantInput = document.getElementById('transaction-merchant');
        const suggestionsContainer = document.getElementById('merchant-suggestions');
        const categorySelect = document.getElementById('transaction-category');

        let merchants = [];
        let currentHighlight = -1;

        // Load merchants when database is ready
        const loadMerchants = async () => {
            try {
                merchants = await this.dataManager.getUniqueMerchants();
            } catch (error) {
                console.log('Could not load merchants yet:', error);
                merchants = [];
            }
        };

        // Initial load
        await loadMerchants();

        // Reload merchants after adding transactions
        const originalAddTransaction = this.addTransaction.bind(this);
        this.addTransaction = async function() {
            await originalAddTransaction();
            await loadMerchants();
        };

        // Filter and display suggestions
        const showSuggestions = (filter) => {
            const filtered = merchants.filter(merchant =>
                merchant.toLowerCase().includes(filter.toLowerCase())
            );

            if (filtered.length === 0 || (filtered.length === 1 && filtered[0].toLowerCase() === filter.toLowerCase())) {
                suggestionsContainer.classList.remove('active');
                return;
            }

            suggestionsContainer.innerHTML = filtered.map((merchant, index) =>
                `<div class="autocomplete-suggestion" data-index="${index}">${merchant}</div>`
            ).join('');

            suggestionsContainer.classList.add('active');
            currentHighlight = -1;
        };

        // Hide suggestions
        const hideSuggestions = () => {
            suggestionsContainer.classList.remove('active');
            currentHighlight = -1;
        };

        // Select merchant and auto-populate category
        const selectMerchant = async (merchant) => {
            merchantInput.value = merchant;
            hideSuggestions();

            // Auto-populate category
            try {
                const commonCategory = await this.dataManager.getMostCommonCategoryForMerchant(merchant);
                if (commonCategory) {
                    categorySelect.value = commonCategory;
                }
            } catch (error) {
                console.log('Could not auto-populate category:', error);
            }
        };

        // Event listeners
        merchantInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            if (value.length > 0) {
                showSuggestions(value);
            } else {
                hideSuggestions();
            }
        });

        merchantInput.addEventListener('blur', (e) => {
            // Delay hiding to allow click on suggestions
            setTimeout(() => {
                if (!suggestionsContainer.contains(document.activeElement)) {
                    hideSuggestions();
                }
            }, 150);
        });

        merchantInput.addEventListener('keydown', (e) => {
            const suggestions = suggestionsContainer.querySelectorAll('.autocomplete-suggestion');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                currentHighlight = Math.min(currentHighlight + 1, suggestions.length - 1);
                updateHighlight(suggestions);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                currentHighlight = Math.max(currentHighlight - 1, -1);
                updateHighlight(suggestions);
            } else if (e.key === 'Enter' && currentHighlight >= 0) {
                e.preventDefault();
                const selectedMerchant = suggestions[currentHighlight].textContent;
                selectMerchant(selectedMerchant);
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        });

        suggestionsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('autocomplete-suggestion')) {
                selectMerchant(e.target.textContent);
            }
        });

        // Update highlight
        const updateHighlight = (suggestions) => {
            suggestions.forEach((suggestion, index) => {
                suggestion.classList.toggle('highlighted', index === currentHighlight);
            });
        };
    }

    async setupEditMerchantAutocomplete() {
        const merchantInput = document.getElementById('edit-transaction-merchant');
        const suggestionsContainer = document.getElementById('edit-merchant-suggestions');
        const categorySelect = document.getElementById('edit-transaction-category');

        let merchants = [];
        let currentHighlight = -1;

        // Load merchants when database is ready
        const loadMerchants = async () => {
            try {
                merchants = await this.dataManager.getUniqueMerchants();
            } catch (error) {
                console.log('Could not load merchants yet:', error);
                merchants = [];
            }
        };

        // Initial load
        await loadMerchants();

        // Filter and display suggestions
        const showSuggestions = (filter) => {
            const filtered = merchants.filter(merchant =>
                merchant.toLowerCase().includes(filter.toLowerCase())
            );

            if (filtered.length === 0 || (filtered.length === 1 && filtered[0].toLowerCase() === filter.toLowerCase())) {
                suggestionsContainer.classList.remove('active');
                return;
            }

            suggestionsContainer.innerHTML = filtered.map((merchant, index) =>
                `<div class="autocomplete-suggestion" data-index="${index}">${merchant}</div>`
            ).join('');

            suggestionsContainer.classList.add('active');
            currentHighlight = -1;
        };

        // Hide suggestions
        const hideSuggestions = () => {
            suggestionsContainer.classList.remove('active');
            currentHighlight = -1;
        };

        // Select merchant and auto-populate category
        const selectMerchant = async (merchant) => {
            merchantInput.value = merchant;
            hideSuggestions();

            // Auto-populate category
            try {
                const commonCategory = await this.dataManager.getMostCommonCategoryForMerchant(merchant);
                if (commonCategory) {
                    categorySelect.value = commonCategory;
                }
            } catch (error) {
                console.log('Could not auto-populate category:', error);
            }
        };

        // Event listeners
        merchantInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            if (value.length > 0) {
                showSuggestions(value);
            } else {
                hideSuggestions();
            }
        });

        merchantInput.addEventListener('blur', (e) => {
            // Delay hiding to allow click on suggestions
            setTimeout(() => {
                if (!suggestionsContainer.contains(document.activeElement)) {
                    hideSuggestions();
                }
            }, 150);
        });

        merchantInput.addEventListener('keydown', (e) => {
            const suggestions = suggestionsContainer.querySelectorAll('.autocomplete-suggestion');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                currentHighlight = Math.min(currentHighlight + 1, suggestions.length - 1);
                updateHighlight(suggestions);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                currentHighlight = Math.max(currentHighlight - 1, -1);
                updateHighlight(suggestions);
            } else if (e.key === 'Enter' && currentHighlight >= 0) {
                e.preventDefault();
                const selectedMerchant = suggestions[currentHighlight].textContent;
                selectMerchant(selectedMerchant);
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        });

        suggestionsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('autocomplete-suggestion')) {
                selectMerchant(e.target.textContent);
            }
        });

        // Update highlight
        const updateHighlight = (suggestions) => {
            suggestions.forEach((suggestion, index) => {
                suggestion.classList.toggle('highlighted', index === currentHighlight);
            });
        };
    }

    setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');

                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                button.classList.add('active');
                document.getElementById(targetTab).classList.add('active');
            });
        });
    }

    async addTransaction() {
        const form = document.getElementById('transaction-form');

        const transactionData = {
            date: document.getElementById('transaction-date').value,
            amount: parseFloat(document.getElementById('transaction-amount').value),
            merchant: document.getElementById('transaction-merchant').value,
            category: document.getElementById('transaction-category').value,
            description: document.getElementById('transaction-description').value || ''
        };

        // Validate required fields
        if (!transactionData.date || !transactionData.amount || !transactionData.merchant) {
            alert('Please fill in all required fields');
            return;
        }

        await this.dataManager.addTransaction(transactionData);

        form.reset();
        document.getElementById('transaction-date').valueAsDate = new Date();

        // Update all views
        await this.renderRecommendations();
        await this.renderTransactions();
        await this.renderDashboard();

        // Show success feedback
        const button = form.querySelector('button[type="submit"]');
        const originalText = button.textContent;
        button.textContent = 'Added!';
        button.style.backgroundColor = '#28a745';
        setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = '';
        }, 1000);
    }

    async deleteTransaction(id) {
        if (confirm('Are you sure you want to delete this transaction?')) {
            await this.dataManager.deleteTransaction(id);
            await this.renderRecommendations();
            await this.renderTransactions();
            await this.renderDashboard();
        }
    }

    async editTransaction(id) {
        const transactions = await this.dataManager.getTransactions();
        const transaction = transactions.find(t => t.id === id);

        if (!transaction) {
            alert('Transaction not found');
            return;
        }

        // Populate the edit form
        document.getElementById('edit-transaction-date').value = transaction.date;
        document.getElementById('edit-transaction-amount').value = transaction.amount;
        document.getElementById('edit-transaction-merchant').value = transaction.merchant;
        document.getElementById('edit-transaction-category').value = transaction.category;
        document.getElementById('edit-transaction-description').value = transaction.description || '';

        // Show matching offers
        const matchingOffers = await this.dataManager.getMatchingOffersForTransaction(transaction);
        const matchingOffersContainer = document.getElementById('edit-matching-offers');

        if (matchingOffers.length > 0) {
            matchingOffersContainer.innerHTML = matchingOffers.map(offer => `
                <div style="background: #e7f5e7; padding: 0.5rem; margin: 0.25rem 0; border-radius: 5px; font-size: 0.9rem;">
                    <strong>${offer.name}</strong> - $${offer.reward}${offer.bonusReward ? ` + $${offer.bonusReward} bonus` : ''}
                </div>
            `).join('');
        } else {
            matchingOffersContainer.innerHTML = '<div style="color: #666; font-style: italic;">No matching offers for this transaction</div>';
        }

        // Store the transaction ID for updating
        this.currentEditingTransactionId = id;

        // Show the modal
        document.getElementById('transaction-edit-modal').classList.add('active');
    }

    hideTransactionEditModal() {
        document.getElementById('transaction-edit-modal').classList.remove('active');
        this.currentEditingTransactionId = null;
    }

    async updateTransaction() {
        if (!this.currentEditingTransactionId) {
            alert('No transaction selected for editing');
            return;
        }

        const transactionData = {
            date: document.getElementById('edit-transaction-date').value,
            amount: parseFloat(document.getElementById('edit-transaction-amount').value),
            merchant: document.getElementById('edit-transaction-merchant').value,
            category: document.getElementById('edit-transaction-category').value,
            description: document.getElementById('edit-transaction-description').value || ''
        };

        // Validate required fields
        if (!transactionData.date || !transactionData.amount || !transactionData.merchant) {
            alert('Please fill in all required fields');
            return;
        }

        await this.dataManager.updateTransaction(this.currentEditingTransactionId, transactionData);

        this.hideTransactionEditModal();
        await this.renderRecommendations();
        await this.renderTransactions();
        await this.renderDashboard();
    }

    showOfferForm(offer = null) {
        this.currentEditingOffer = offer;
        const container = document.getElementById('offer-form-container');
        const form = document.getElementById('offer-form');

        if (offer) {
            document.getElementById('offer-name').value = offer.name;
            document.getElementById('offer-type').value = offer.type;
            document.getElementById('offer-start-date').value = offer.startDate;
            document.getElementById('offer-end-date').value = offer.endDate;
            document.getElementById('offer-spending-target').value = offer.spendingTarget || '';
            document.getElementById('offer-transaction-target').value = offer.transactionTarget || '';
            document.getElementById('offer-min-transaction').value = offer.minTransaction || '';
            document.getElementById('offer-category').value = offer.category || '';
            document.getElementById('offer-reward').value = offer.reward;
            document.getElementById('offer-bonus-reward').value = offer.bonusReward || '';
            document.getElementById('offer-description').value = offer.description || '';
            document.getElementById('offer-monthly-tracking').checked = offer.monthlyTracking || false;
        } else {
            form.reset();
        }

        container.classList.remove('hidden');
    }

    hideOfferForm() {
        document.getElementById('offer-form-container').classList.add('hidden');
        document.getElementById('offer-form').reset();
        this.currentEditingOffer = null;
    }

    async saveOffer() {
        const form = document.getElementById('offer-form');
        const formData = new FormData(form);

        const offerData = {
            name: formData.get('offer-name') || document.getElementById('offer-name').value,
            type: formData.get('offer-type') || document.getElementById('offer-type').value,
            startDate: formData.get('offer-start-date') || document.getElementById('offer-start-date').value,
            endDate: formData.get('offer-end-date') || document.getElementById('offer-end-date').value,
            spendingTarget: parseFloat(formData.get('offer-spending-target') || document.getElementById('offer-spending-target').value) || null,
            transactionTarget: parseInt(formData.get('offer-transaction-target') || document.getElementById('offer-transaction-target').value) || null,
            minTransaction: parseFloat(formData.get('offer-min-transaction') || document.getElementById('offer-min-transaction').value) || null,
            category: formData.get('offer-category') || document.getElementById('offer-category').value,
            reward: parseFloat(formData.get('offer-reward') || document.getElementById('offer-reward').value),
            bonusReward: parseFloat(formData.get('offer-bonus-reward') || document.getElementById('offer-bonus-reward').value) || null,
            description: formData.get('offer-description') || document.getElementById('offer-description').value,
            monthlyTracking: document.getElementById('offer-monthly-tracking').checked
        };

        if (this.currentEditingOffer) {
            await this.dataManager.updateOffer(this.currentEditingOffer.id, offerData);
        } else {
            await this.dataManager.addOffer(offerData);
        }

        this.hideOfferForm();
        await this.renderRecommendations();
        await this.renderOffers();
        await this.renderDashboard();
        await this.renderTransactions();
    }

    async deleteOffer(id) {
        if (confirm('Are you sure you want to delete this offer?')) {
            await this.dataManager.deleteOffer(id);
            await this.renderRecommendations();
            await this.renderOffers();
            await this.renderDashboard();
            await this.renderTransactions();
        }
    }

    async renderDashboard() {
        const container = document.getElementById('offer-progress');
        const offers = await this.dataManager.getOffers();
        console.log('Dashboard: Found', offers.length, 'offers:', offers);

        let totalEarned = 0;
        let totalPotential = 0;
        let activeOffers = 0;

        const offerCards = await Promise.all(offers.map(async offer => {
            const progress = await this.dataManager.calculateOfferProgress(offer);

            if (progress.status === 'active') {
                activeOffers++;
            }

            totalPotential += offer.reward;
            if (offer.bonusReward) {
                totalPotential += offer.bonusReward;
            }

            let earned = 0;
            if (offer.monthlyTracking) {
                earned += progress.totalCompleted * offer.reward;
                if (offer.bonusReward && progress.totalCompleted === progress.months.length) {
                    earned += offer.bonusReward;
                }
            } else if (progress.completed) {
                earned += offer.reward;
            }
            totalEarned += earned;

            return `
                <div class="offer-card">
                    <div class="offer-header">
                        <div class="offer-name">${offer.name}</div>
                        <div class="offer-reward">$${offer.reward}${offer.bonusReward ? ` + $${offer.bonusReward} bonus` : ''}</div>
                    </div>
                    <div class="offer-details">
                        <div class="status-badge status-${progress.status}">${progress.status.toUpperCase()}</div>
                        <div class="offer-type-badge">${this.getOfferTypeLabel(offer)}</div>
                        <p><strong>Period:</strong> ${new Date(offer.startDate + 'T00:00:00').toLocaleDateString()} - ${new Date(offer.endDate + 'T00:00:00').toLocaleDateString()}</p>
                        <p>${offer.description}</p>
                    </div>
                    ${offer.monthlyTracking ? this.renderMonthlyProgress(offer, progress) : this.renderSingleProgress(offer, progress)}
                    <div class="progress-text">
                        <strong>Earned:</strong> $${earned.toFixed(2)}
                    </div>
                </div>
            `;
        }));

        const summary = `
            <div class="dashboard-summary">
                <div class="summary-card">
                    <div class="summary-value">$${totalEarned.toFixed(2)}</div>
                    <div class="summary-label">Total Earned</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">$${totalPotential.toFixed(2)}</div>
                    <div class="summary-label">Total Potential</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${activeOffers}</div>
                    <div class="summary-label">Active Offers</div>
                </div>
            </div>
        `;

        container.innerHTML = summary + offerCards.join('');
    }

    renderMonthlyProgress(offer, progress) {
        const monthsHtml = progress.months.map(month => {
            let progressBar = '';
            let progressText = '';

            if (offer.type === 'spending' && offer.spendingTarget) {
                const percentage = Math.min((month.spending / offer.spendingTarget) * 100, 100);
                progressBar = `<div class="progress-bar" style="width: ${percentage}%"></div>`;
                progressText = `$${month.spending.toFixed(2)} / $${offer.spendingTarget}`;
            } else if (offer.type === 'transactions' && offer.transactionTarget) {
                const percentage = Math.min((month.transactionCount / offer.transactionTarget) * 100, 100);
                progressBar = `<div class="progress-bar" style="width: ${percentage}%"></div>`;
                progressText = `${month.transactionCount} / ${offer.transactionTarget} transactions`;
            }

            return `
                <div style="margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <strong>${month.month}</strong>
                        <span class="status-badge ${month.completed ? 'status-completed' : 'status-active'}">
                            ${month.completed ? 'COMPLETED' : 'IN PROGRESS'}
                        </span>
                    </div>
                    <div class="offer-progress">
                        ${progressBar}
                    </div>
                    <div class="progress-text">${progressText}</div>
                </div>
            `;
        }).join('');

        return `
            <div>
                ${monthsHtml}
                <div class="progress-text">
                    <strong>Completed Months:</strong> ${progress.totalCompleted} / ${progress.months.length}
                </div>
            </div>
        `;
    }

    renderSingleProgress(offer, progress) {
        let progressText = '';

        if (offer.type === 'spending' && offer.spendingTarget) {
            progressText = `$${progress.totalSpending.toFixed(2)} / $${offer.spendingTarget}`;
        } else if (offer.type === 'transactions' && offer.transactionTarget) {
            progressText = `${progress.totalTransactions} / ${offer.transactionTarget} transactions`;
        }

        return `
            <div class="offer-progress">
                <div class="progress-bar" style="width: ${progress.progress}%"></div>
            </div>
            <div class="progress-text">${progressText}</div>
        `;
    }

    async renderTransactions() {
        const container = document.getElementById('transaction-list');
        const transactions = await this.dataManager.getTransactions();

        if (transactions.length === 0) {
            container.innerHTML = '<p>No transactions yet. Add your first transaction above!</p>';
            return;
        }

        const transactionHtml = await Promise.all(transactions.slice(0, 10).map(async transaction => {
            const matchingOffers = await this.dataManager.getMatchingOffersForTransaction(transaction);
            const matchingOffersHtml = matchingOffers.length > 0
                ? `<div style="font-size: 0.8rem; color: #28a745; margin-top: 0.25rem;">Matches: ${matchingOffers.map(o => o.name).join(', ')}</div>`
                : '';

            return `
                <div class="transaction-item">
                    <div class="transaction-info">
                        <div class="transaction-date">${new Date(transaction.date + 'T00:00:00').toLocaleDateString()}</div>
                        <div class="transaction-merchant">${transaction.merchant}</div>
                        ${transaction.description ? `<div style="font-size: 0.9rem; color: #666;">${transaction.description}</div>` : ''}
                        <div class="transaction-category">${transaction.category}</div>
                        ${matchingOffersHtml}
                    </div>
                    <div style="text-align: right;">
                        <div class="transaction-amount">$${transaction.amount.toFixed(2)}</div>
                        <div style="margin-top: 0.5rem;">
                            <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin-right: 0.25rem;" onclick="tracker.editTransaction(${transaction.id})">Edit</button>
                            <button class="btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="tracker.deleteTransaction(${transaction.id})">Delete</button>
                        </div>
                    </div>
                </div>
            `;
        }));

        container.innerHTML = transactionHtml.join('');
    }

    async renderOffers() {
        const container = document.getElementById('offer-list');
        const offers = await this.dataManager.getOffers();

        if (offers.length === 0) {
            container.innerHTML = '<p>No offers yet. Add your first offer above!</p>';
            return;
        }

        const offersHtml = await Promise.all(offers.map(async offer => {
            const progress = await this.dataManager.calculateOfferProgress(offer);

            return `
                <div class="offer-card">
                    <div class="offer-header">
                        <div class="offer-name">${offer.name}</div>
                        <div class="offer-reward">$${offer.reward}${offer.bonusReward ? ` + $${offer.bonusReward} bonus` : ''}</div>
                    </div>
                    <div class="offer-details">
                        <div class="status-badge status-${progress.status}">${progress.status.toUpperCase()}</div>
                        <div class="offer-type-badge">${this.getOfferTypeLabel(offer)}</div>
                        <p><strong>Period:</strong> ${new Date(offer.startDate + 'T00:00:00').toLocaleDateString()} - ${new Date(offer.endDate + 'T00:00:00').toLocaleDateString()}</p>
                        ${offer.spendingTarget ? `<p><strong>Spending Target:</strong> $${offer.spendingTarget}</p>` : ''}
                        ${offer.transactionTarget ? `<p><strong>Transaction Target:</strong> ${offer.transactionTarget}</p>` : ''}
                        ${offer.minTransaction ? `<p><strong>Min Transaction:</strong> $${offer.minTransaction}</p>` : ''}
                        ${offer.category ? `<p><strong>Category:</strong> ${offer.category}</p>` : ''}
                        <p>${offer.description}</p>
                    </div>
                    <div class="offer-actions">
                        <button class="btn-secondary" onclick="tracker.editOffer(${offer.id})">Edit</button>
                        <button class="btn-danger" onclick="tracker.deleteOffer(${offer.id})">Delete</button>
                    </div>
                </div>
            `;
        }));

        container.innerHTML = offersHtml.join('');
    }

    async editOffer(id) {
        const offer = await this.dataManager.getOffer(id);
        this.showOfferForm(offer);
    }

    getOfferTypeLabel(offer) {
        let label = '';

        // Determine base type
        if (offer.type === 'spending' && offer.spendingTarget) {
            if (offer.monthlyTracking) {
                label = 'Monthly Spending';
                if (offer.bonusReward) {
                    label += ' + Completion Bonus';
                }
            } else {
                label = offer.category ? 'Category Spending' : 'Total Spending';
            }
        } else if (offer.type === 'transactions' && offer.transactionTarget) {
            if (offer.monthlyTracking) {
                label = 'Monthly Purchase Count';
            } else {
                label = offer.category ? 'Category Purchase Count' : 'Total Purchase Count';
            }
        } else if (offer.type === 'combo') {
            label = 'Combination Offer';
        }

        // Add category if specified
        if (offer.category && !label.includes('Category')) {
            label += ` (${offer.category.charAt(0).toUpperCase() + offer.category.slice(1)})`;
        }

        // Add minimum transaction requirement
        if (offer.minTransaction) {
            label += ` (Min $${offer.minTransaction})`;
        }

        return label || 'Custom Offer';
    }

    async renderRecommendations() {
        const ultraHighContainer = document.getElementById('ultra-high-recommendations');
        const allRecommendationsContainer = document.getElementById('all-recommendations');

        try {
            const { recommendations, overlaps, masterStrategy } = await this.dataManager.getOptimalSpendingRecommendations();

            // Render master strategy on dashboard
            if (!masterStrategy) {
                ultraHighContainer.innerHTML = `
                    <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; text-align: center; color: #666;">
                        <p>🎉 All offers completed!</p>
                        <p>No active offers requiring attention.</p>
                    </div>
                `;
            } else {
                ultraHighContainer.innerHTML = this.renderMasterStrategy(masterStrategy);
            }

            // Render all recommendations on the recommendations tab
            if (recommendations.length === 0) {
                allRecommendationsContainer.innerHTML = `
                    <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; text-align: center; color: #666;">
                        <p>🎉 Great job! No optimization opportunities found.</p>
                        <p>All active offers are either completed or don't overlap.</p>
                    </div>
                `;
            } else {
                const allRecommendationsHtml = recommendations.map(rec => this.renderRecommendationCard(rec)).join('');
                allRecommendationsContainer.innerHTML = allRecommendationsHtml;
            }

        } catch (error) {
            console.error('Error rendering recommendations:', error);
            const errorHtml = `
                <div style="background: #f8d7da; padding: 1rem; border-radius: 5px; color: #721c24;">
                    Error loading recommendations. Please try again.
                </div>
            `;
            ultraHighContainer.innerHTML = errorHtml;
            allRecommendationsContainer.innerHTML = errorHtml;
        }
    }

    renderRecommendationCard(rec) {
        const priorityClass = `priority-${rec.priority}`;
        const savingsHtml = rec.savings ?
            `<div class="savings-badge">${rec.savings.description}</div>` : '';

        let priorityBadge = '';
        if (rec.priority === 'ultra-high') {
            priorityBadge = '<span class="priority-badge" style="background: #8b0000;">🔥 ULTRA HIGH PRIORITY</span>';
        } else if (rec.priority === 'high') {
            priorityBadge = '<span class="priority-badge">HIGH PRIORITY</span>';
        }

        const offerCountBadge = rec.offerCount > 2 ?
            `<span class="offer-count-badge">${rec.offerCount} OFFERS</span>` : '';

        return `
            <div class="recommendation-card ${priorityClass}">
                <div class="recommendation-header">
                    <h3>${rec.title}</h3>
                    <div class="badges">
                        ${priorityBadge}
                        ${offerCountBadge}
                        ${savingsHtml}
                    </div>
                </div>
                <div class="recommendation-details">
                    <div class="rec-period"><strong>Period:</strong> ${rec.period}</div>
                    <div class="rec-category"><strong>Category:</strong> ${rec.category}</div>
                    ${rec.minTransaction > 0 ? `<div class="rec-min"><strong>Min per transaction:</strong> $${rec.minTransaction}</div>` : ''}
                </div>
                <div class="strategy-list">
                    <strong>Strategy:</strong>
                    <ul>
                        ${rec.strategy.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>
                <div class="affected-offers">
                    <strong>Affects offers:</strong> ${rec.offers.join(', ')}
                </div>
            </div>
        `;
    }

    renderMasterStrategy(masterStrategy) {
        if (!masterStrategy) return '';

        const priorityClass = 'priority-master';
        const totalRewardHtml = masterStrategy.totalPotentialReward ?
            `<div class="total-reward-badge">💰 $${masterStrategy.totalPotentialReward.toFixed(2)} Total</div>` : '';

        return `
            <div class="recommendation-card ${priorityClass} master-strategy">
                <div class="recommendation-header">
                    <h3>${masterStrategy.title}</h3>
                    <div class="badges">
                        ${totalRewardHtml}
                    </div>
                </div>
                <div class="strategy-list master-strategy-content">
                    ${masterStrategy.strategy.map(s => `<div class="strategy-line">${s}</div>`).join('')}
                </div>
                <div class="affected-offers">
                    <strong>All Active Offers:</strong> ${masterStrategy.offers.join(', ')}
                </div>
            </div>
        `;
    }
}

const tracker = new OfferTracker();
window.tracker = tracker;