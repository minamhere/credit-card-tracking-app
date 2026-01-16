class OfferTracker {
    constructor() {
        this.dataManager = new DataManager();
        this.currentEditingOffer = null;
        this.personalConfig = this.dataManager.getPersonalConfig();
        // Initialize with default categories
        this.availableCategories = this.loadCategories();
        this.currentTransactionPage = 1;
        this.transactionsPerPage = 20;
        this.init();
    }

    loadCategories() {
        // Load from localStorage or use defaults
        const stored = localStorage.getItem('availableCategories');
        if (stored) {
            return JSON.parse(stored);
        }
        // Default categories
        return ['general', 'online', 'grocery', 'gas', 'restaurant', 'retail', 'travel', 'dining'];
    }

    saveCategories() {
        localStorage.setItem('availableCategories', JSON.stringify(this.availableCategories));
    }

    addCategory(category) {
        const normalized = category.toLowerCase().trim();
        if (normalized && !this.availableCategories.includes(normalized)) {
            this.availableCategories.push(normalized);
            this.availableCategories.sort();
            this.saveCategories();
            this.renderCategoryCheckboxes();
        }
    }

    renderCategoryCheckboxes() {
        // Render for transaction form
        this.renderCheckboxesInContainer('transaction-categories-checkboxes', 'transaction-category');
        // Render for edit transaction form
        this.renderCheckboxesInContainer('edit-transaction-categories-checkboxes', 'edit-transaction-category');
        // Render for offer form
        this.renderCheckboxesInContainer('offer-categories-checkboxes', 'offer-category');
    }

    renderCheckboxesInContainer(containerId, inputName) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = this.availableCategories.map(cat => `
            <label>
                <input type="checkbox" name="${inputName}" value="${cat}">
                ${cat.charAt(0).toUpperCase() + cat.slice(1)}
            </label>
        `).join('');
    }

    async init() {
        this.setupEventListeners();
        this.setupTabs();
        this.renderCategoryCheckboxes();
        this.setupOfferTypeToggle();
        this.setupThemeToggle();

        // Initialize database (will show modal)
        await this.dataManager.initialize();
    }

    setupOfferTypeToggle() {
        const offerTypeSelect = document.getElementById('offer-type');
        const percentBackFields = document.getElementById('percent-back-fields');
        const standardFields = document.getElementById('standard-offer-fields');
        const rewardFields = document.getElementById('reward-fields');

        offerTypeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'percent-back') {
                percentBackFields.style.display = 'block';
                standardFields.style.display = 'none';
                rewardFields.style.display = 'none';
            } else {
                percentBackFields.style.display = 'none';
                standardFields.style.display = 'block';
                rewardFields.style.display = 'block';
            }
        });
    }

    setupThemeToggle() {
        // Load saved theme or default to light mode
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // Update toggle button text and icon
        const themeToggle = document.getElementById('theme-toggle');
        const themeIcon = themeToggle.querySelector('.theme-toggle-icon');
        const themeText = themeToggle.querySelector('.theme-toggle-text');

        const updateThemeButton = (theme) => {
            if (theme === 'dark') {
                themeIcon.textContent = '☀️';
                themeText.textContent = 'Light Mode';
            } else {
                themeIcon.textContent = '🌙';
                themeText.textContent = 'Dark Mode';
            }
        };

        // Set initial button state
        updateThemeButton(savedTheme);

        // Toggle theme on button click
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeButton(newTheme);
        });
    }

    async onDatabaseReady() {
        console.log('onDatabaseReady called');
        // Called when database is ready
        try {
            console.log('Loading people...');
            await this.loadPeople();
            console.log('Rendering dashboard...');
            await this.renderDashboard();
            console.log('Rendering transactions...');
            await this.renderTransactions();
            console.log('Rendering offers...');
            await this.renderOffers();
            console.log('All rendering complete');

            // Set default transaction date to today in local timezone
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            document.getElementById('transaction-date').value = `${yyyy}-${mm}-${dd}`;
        } catch (error) {
            console.error('Error in onDatabaseReady:', error);
        }
    }

    async loadPeople() {
        const people = await this.dataManager.dbManager.getPeople();
        const personSelect = document.getElementById('person-select');
        personSelect.innerHTML = '';

        if (people.length === 0) {
            personSelect.innerHTML = '<option value="">No card holders</option>';
            return;
        }

        people.forEach(person => {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = person.name;
            personSelect.appendChild(option);
        });

        // Set current person
        const currentPersonId = this.dataManager.dbManager.getCurrentPerson();
        if (currentPersonId && people.some(p => p.id == currentPersonId)) {
            personSelect.value = currentPersonId;
        } else {
            // Default to first person
            personSelect.value = people[0].id;
            this.dataManager.dbManager.setCurrentPerson(people[0].id);
        }
    }

    async onPersonChange() {
        const personSelect = document.getElementById('person-select');
        const personId = personSelect.value;

        if (!personId) return;

        this.dataManager.dbManager.setCurrentPerson(personId);

        // Reload all data
        await this.renderDashboard();
        await this.renderTransactions();
        await this.renderOffers();
    }

    showPeopleModal() {
        document.getElementById('people-modal').style.display = 'block';
        this.renderPeopleList();
    }

    hidePeopleModal() {
        document.getElementById('people-modal').style.display = 'none';
    }

    async renderPeopleList() {
        const people = await this.dataManager.dbManager.getPeople();
        const peopleList = document.getElementById('people-list');

        if (people.length === 0) {
            peopleList.innerHTML = '<p>No card holders yet. Add one below.</p>';
            return;
        }

        peopleList.innerHTML = people.map(person => `
            <div class="person-item">
                <span id="person-name-${person.id}">${person.name}</span>
                <div>
                    <button class="small-btn" onclick="tracker.renamePerson(${person.id}, '${person.name.replace(/'/g, "\\'")}')">Rename</button>
                    <button class="delete-btn" onclick="tracker.deletePerson(${person.id}, '${person.name.replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    async addPerson() {
        const nameInput = document.getElementById('new-person-name');
        const name = nameInput.value.trim();

        if (!name) {
            alert('Please enter a name');
            return;
        }

        try {
            await this.dataManager.dbManager.addPerson(name);
            nameInput.value = '';
            await this.renderPeopleList();
            await this.loadPeople();
        } catch (error) {
            alert('Failed to add person: ' + error.message);
        }
    }

    async renamePerson(id, currentName) {
        const newName = prompt(`Rename "${currentName}" to:`, currentName);

        if (!newName || newName.trim() === '') {
            return;
        }

        if (newName.trim() === currentName) {
            return; // No change
        }

        try {
            await this.dataManager.dbManager.updatePerson(id, newName.trim());
            await this.renderPeopleList();
            await this.loadPeople();
        } catch (error) {
            alert('Failed to rename person: ' + error.message);
        }
    }

    async deletePerson(id, name) {
        if (!confirm(`Are you sure you want to delete "${name}"? This will delete all their offers and transactions.`)) {
            return;
        }

        try {
            await this.dataManager.dbManager.deletePerson(id);
            await this.renderPeopleList();
            await this.loadPeople();

            // Refresh views
            await this.renderDashboard();
            await this.renderTransactions();
            await this.renderOffers();
        } catch (error) {
            alert('Failed to delete person: ' + error.message);
        }
    }

    setupEventListeners() {
        // Person selector event listeners
        document.getElementById('person-select').addEventListener('change', () => {
            this.onPersonChange();
        });

        document.getElementById('manage-people-btn').addEventListener('click', () => {
            this.showPeopleModal();
        });

        document.getElementById('close-people-modal').addEventListener('click', () => {
            this.hidePeopleModal();
        });

        document.getElementById('add-person-btn').addEventListener('click', () => {
            this.addPerson();
        });

        // Category management event listeners
        document.getElementById('offer-add-category-btn').addEventListener('click', () => {
            const input = document.getElementById('offer-custom-category');
            this.addCategory(input.value);
            input.value = '';
        });

        document.getElementById('transaction-add-category-btn').addEventListener('click', () => {
            const input = document.getElementById('transaction-custom-category');
            this.addCategory(input.value);
            input.value = '';
        });

        document.getElementById('edit-transaction-add-category-btn').addEventListener('click', () => {
            const input = document.getElementById('edit-transaction-custom-category');
            this.addCategory(input.value);
            input.value = '';
        });

        // Transaction and offer event listeners
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
        this.setupMerchantDropdown();
        this.setupEditMerchantAutocomplete();
    }

    async setupMerchantDropdown() {
        const merchantSelect = document.getElementById('transaction-merchant-select');
        const newMerchantContainer = document.getElementById('new-merchant-container');
        const newMerchantInput = document.getElementById('transaction-merchant-new');

        // Load and populate merchant dropdown
        const loadMerchants = async () => {
            try {
                const merchants = await this.dataManager.getUniqueMerchants();

                // Clear existing merchant options but keep the first (prompt) and last ("Add New")
                // Remove at index 1 repeatedly until only 2 options remain (prompt and Add New)
                while (merchantSelect.options.length > 2) {
                    merchantSelect.remove(1);
                }

                // Add merchants to dropdown before the "Add New" option
                merchants.forEach(merchant => {
                    const option = document.createElement('option');
                    option.value = merchant;
                    option.textContent = merchant;
                    merchantSelect.insertBefore(option, merchantSelect.options[merchantSelect.options.length - 1]); // Insert before "Add New" (last option)
                });
            } catch (error) {
                console.log('Could not load merchants yet:', error);
            }
        };

        // Initial load
        await loadMerchants();

        // Reload merchants after adding transactions
        const originalAddTransaction = this.addTransaction.bind(this);
        this.addTransaction = async function() {
            await originalAddTransaction();
            await loadMerchants();
        }.bind(this);

        // Handle merchant selection
        const selectMerchant = async (merchant) => {
            // Auto-populate categories for selected merchant
            try {
                const commonCategories = await this.dataManager.getMostCommonCategoryForMerchant(merchant);
                if (commonCategories && commonCategories.length > 0) {
                    const categoryCheckboxes = document.querySelectorAll('input[name="transaction-category"]');
                    categoryCheckboxes.forEach(checkbox => {
                        checkbox.checked = commonCategories.includes(checkbox.value);
                    });
                }
            } catch (error) {
                console.log('Could not auto-populate categories:', error);
            }
        };

        // Event listener for merchant selection
        merchantSelect.addEventListener('change', async (e) => {
            const selectedValue = e.target.value;

            if (selectedValue === '__ADD_NEW__') {
                // Show new merchant input
                newMerchantContainer.style.display = 'block';
                newMerchantInput.required = true;
                newMerchantInput.focus();

                // Clear categories to allow manual selection
                const categoryCheckboxes = document.querySelectorAll('input[name="transaction-category"]');
                categoryCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            } else if (selectedValue) {
                // Hide new merchant input
                newMerchantContainer.style.display = 'none';
                newMerchantInput.required = false;
                newMerchantInput.value = '';

                // Auto-populate categories for existing merchant
                await selectMerchant(selectedValue);
            } else {
                // Empty selection - hide new merchant input
                newMerchantContainer.style.display = 'none';
                newMerchantInput.required = false;
                newMerchantInput.value = '';
            }
        });
    }

    async setupEditMerchantAutocomplete() {
        const merchantInput = document.getElementById('edit-transaction-merchant');
        const suggestionsContainer = document.getElementById('edit-merchant-suggestions');

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

            // Auto-populate categories - query checkboxes dynamically
            try {
                const commonCategories = await this.dataManager.getMostCommonCategoryForMerchant(merchant);
                if (commonCategories && commonCategories.length > 0) {
                    // Query checkboxes fresh each time (in case categories were added)
                    const categoryCheckboxes = document.querySelectorAll('input[name="edit-transaction-category"]');
                    categoryCheckboxes.forEach(checkbox => {
                        checkbox.checked = commonCategories.includes(checkbox.value);
                    });
                }
            } catch (error) {
                console.log('Could not auto-populate categories:', error);
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

                // Reset merchant dropdown state when switching tabs
                const newMerchantContainer = document.getElementById('new-merchant-container');
                const newMerchantInput = document.getElementById('transaction-merchant-new');
                const merchantSelect = document.getElementById('transaction-merchant-select');

                if (newMerchantContainer && merchantSelect) {
                    newMerchantContainer.style.display = 'none';
                    if (newMerchantInput) {
                        newMerchantInput.required = false;
                        newMerchantInput.value = '';
                    }
                    // Don't reset the dropdown selection itself, just hide the new merchant input
                }
            });
        });
    }

    async addTransaction() {
        const form = document.getElementById('transaction-form');

        // Get current person
        const personId = this.dataManager.dbManager.getCurrentPerson();
        if (!personId) {
            alert('Please select a card holder first');
            return;
        }

        // Get selected categories from checkboxes
        const categoryCheckboxes = document.querySelectorAll('input[name="transaction-category"]:checked');
        const categories = Array.from(categoryCheckboxes).map(cb => cb.value);

        // Get merchant from dropdown or new merchant input
        const merchantSelect = document.getElementById('transaction-merchant-select');
        const merchantValue = merchantSelect.value === '__ADD_NEW__'
            ? document.getElementById('transaction-merchant-new').value
            : merchantSelect.value;

        // Get date - store as YYYY-MM-DD (database will treat as local date)
        const dateValue = document.getElementById('transaction-date').value; // YYYY-MM-DD

        const transactionData = {
            date: dateValue,
            amount: parseFloat(document.getElementById('transaction-amount').value),
            merchant: merchantValue,
            categories: categories,
            description: document.getElementById('transaction-description').value || '',
            personId: parseInt(personId)
        };

        // Validate required fields
        if (!transactionData.date || !transactionData.amount || !transactionData.merchant) {
            alert('Please fill in all required fields');
            return;
        }

        await this.dataManager.addTransaction(transactionData);

        form.reset();

        // Set default date to today in local timezone
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('transaction-date').value = `${yyyy}-${mm}-${dd}`;

        // Reset merchant dropdown and hide new merchant input
        merchantSelect.value = '';
        document.getElementById('new-merchant-container').style.display = 'none';
        document.getElementById('transaction-merchant-new').value = '';
        document.getElementById('transaction-merchant-new').required = false;

        // Update all views
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
        // Extract just the date part (YYYY-MM-DD) in case it has time/timezone info
        let dateValue = transaction.date;
        if (typeof dateValue === 'string' && dateValue.includes('T')) {
            dateValue = dateValue.split('T')[0];
        } else if (dateValue instanceof Date) {
            const yyyy = dateValue.getFullYear();
            const mm = String(dateValue.getMonth() + 1).padStart(2, '0');
            const dd = String(dateValue.getDate()).padStart(2, '0');
            dateValue = `${yyyy}-${mm}-${dd}`;
        }
        document.getElementById('edit-transaction-date').value = dateValue;
        document.getElementById('edit-transaction-amount').value = transaction.amount;
        document.getElementById('edit-transaction-merchant').value = transaction.merchant;
        document.getElementById('edit-transaction-description').value = transaction.description || '';

        // Check the appropriate category checkboxes
        const editCategoryCheckboxes = document.querySelectorAll('input[name="edit-transaction-category"]');
        editCategoryCheckboxes.forEach(checkbox => {
            checkbox.checked = (transaction.categories || []).includes(checkbox.value);
        });

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

        // Get current person
        const personId = this.dataManager.dbManager.getCurrentPerson();
        if (!personId) {
            alert('Please select a card holder first');
            return;
        }

        // Get selected categories from checkboxes
        const editCategoryCheckboxes = document.querySelectorAll('input[name="edit-transaction-category"]:checked');
        const categories = Array.from(editCategoryCheckboxes).map(cb => cb.value);

        // Get date - store as YYYY-MM-DD (database will treat as local date)
        const dateValue = document.getElementById('edit-transaction-date').value; // YYYY-MM-DD

        const transactionData = {
            date: dateValue,
            amount: parseFloat(document.getElementById('edit-transaction-amount').value),
            merchant: document.getElementById('edit-transaction-merchant').value,
            categories: categories,
            description: document.getElementById('edit-transaction-description').value || '',
            personId: parseInt(personId)
        };

        // Validate required fields
        if (!transactionData.date || !transactionData.amount || !transactionData.merchant) {
            alert('Please fill in all required fields');
            return;
        }

        await this.dataManager.updateTransaction(this.currentEditingTransactionId, transactionData);

        this.hideTransactionEditModal();
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
            document.getElementById('offer-reward').value = offer.reward || '';
            document.getElementById('offer-bonus-reward').value = offer.bonusReward || '';
            document.getElementById('offer-description').value = offer.description || '';
            document.getElementById('offer-monthly-tracking').checked = offer.monthlyTracking || false;

            // Populate percent-back fields
            document.getElementById('offer-percent-back').value = offer.percentBack || '';
            document.getElementById('offer-max-back').value = offer.maxBack || '';
            document.getElementById('offer-min-spend-threshold').value = offer.minSpendThreshold || '';

            // Show/hide appropriate fields based on type
            const percentBackFields = document.getElementById('percent-back-fields');
            const standardFields = document.getElementById('standard-offer-fields');
            const rewardFields = document.getElementById('reward-fields');
            if (offer.type === 'percent-back') {
                percentBackFields.style.display = 'block';
                standardFields.style.display = 'none';
                rewardFields.style.display = 'none';
            } else {
                percentBackFields.style.display = 'none';
                standardFields.style.display = 'block';
                rewardFields.style.display = 'block';
            }

            // Check the appropriate category checkboxes
            const offerCategoryCheckboxes = document.querySelectorAll('input[name="offer-category"]');
            offerCategoryCheckboxes.forEach(checkbox => {
                checkbox.checked = (offer.categories || []).includes(checkbox.value);
            });

            // Populate tiers field
            if (offer.tiers && offer.tiers.length > 0) {
                const tiersText = offer.tiers.map(t => `${t.threshold}:${t.reward}`).join('\n');
                document.getElementById('offer-tiers').value = tiersText;
            } else {
                document.getElementById('offer-tiers').value = '';
            }
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

        // Helper function to safely parse numbers
        const parseNumber = (value) => {
            const num = parseFloat(value);
            return isNaN(num) ? null : num;
        };

        const parseInteger = (value) => {
            const num = parseInt(value, 10);
            return isNaN(num) ? null : num;
        };

        // Get selected categories from checkboxes
        const categoryCheckboxes = document.querySelectorAll('input[name="offer-category"]:checked');
        const categories = Array.from(categoryCheckboxes).map(cb => cb.value);

        // Parse tiers from text input (format: "threshold:reward" per line)
        const tiersText = document.getElementById('offer-tiers').value.trim();
        const tiers = [];
        if (tiersText) {
            const lines = tiersText.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && trimmed.includes(':')) {
                    const [threshold, reward] = trimmed.split(':');
                    const t = parseFloat(threshold);
                    const r = parseFloat(reward);
                    if (!isNaN(t) && !isNaN(r)) {
                        tiers.push({ threshold: t, reward: r });
                    }
                }
            }
            // Sort tiers by threshold ascending
            tiers.sort((a, b) => a.threshold - b.threshold);
        }

        // Get current person
        const personId = this.dataManager.dbManager.getCurrentPerson();
        if (!personId) {
            alert('Please select a card holder first');
            return;
        }

        const offerData = {
            name: formData.get('offer-name') || document.getElementById('offer-name').value,
            type: formData.get('offer-type') || document.getElementById('offer-type').value,
            startDate: formData.get('offer-start-date') || document.getElementById('offer-start-date').value,
            endDate: formData.get('offer-end-date') || document.getElementById('offer-end-date').value,
            spendingTarget: parseNumber(formData.get('offer-spending-target') || document.getElementById('offer-spending-target').value),
            transactionTarget: parseInteger(formData.get('offer-transaction-target') || document.getElementById('offer-transaction-target').value),
            minTransaction: parseNumber(formData.get('offer-min-transaction') || document.getElementById('offer-min-transaction').value),
            categories: categories,
            reward: parseNumber(formData.get('offer-reward') || document.getElementById('offer-reward').value) || 0,
            bonusReward: parseNumber(formData.get('offer-bonus-reward') || document.getElementById('offer-bonus-reward').value),
            tiers: tiers,
            percentBack: parseNumber(document.getElementById('offer-percent-back').value),
            maxBack: parseNumber(document.getElementById('offer-max-back').value),
            minSpendThreshold: parseNumber(document.getElementById('offer-min-spend-threshold').value),
            description: formData.get('offer-description') || document.getElementById('offer-description').value || '',
            monthlyTracking: document.getElementById('offer-monthly-tracking').checked,
            personId: parseInt(personId)
        };

        if (this.currentEditingOffer) {
            await this.dataManager.updateOffer(this.currentEditingOffer.id, offerData);
        } else {
            await this.dataManager.addOffer(offerData);
        }

        this.hideOfferForm();
        await this.renderOffers();
        await this.renderDashboard();
        await this.renderTransactions();
    }

    async deleteOffer(id) {
        if (confirm('Are you sure you want to delete this offer?')) {
            await this.dataManager.deleteOffer(id);
            await this.renderOffers();
            await this.renderDashboard();
            await this.renderTransactions();
        }
    }

    async renderDashboard() {
        const container = document.getElementById('offer-progress');

        try {
            // Get simplified offer list with progress and transactions
            const offers = await this.dataManager.getSimplifiedOfferList();

            let totalEarned = 0;
            let totalPotential = 0;
            let activeOffers = 0;

            const offerCards = offers.map(offer => {
                const progress = offer.progress;

                if (progress.status === 'active') {
                    activeOffers++;
                }

                // Calculate potential earnings
                if (offer.tiers && offer.tiers.length > 0) {
                    const highestTier = [...offer.tiers].sort((a, b) => b.reward - a.reward)[0];
                    if (offer.monthlyTracking) {
                        const monthCount = progress.months ? progress.months.length : 1;
                        totalPotential += highestTier.reward * monthCount;
                    } else {
                        totalPotential += highestTier.reward;
                    }
                } else if (offer.type === 'percent-back') {
                    // For percent-back offers, use maxBack as potential
                    if (offer.maxBack) {
                        if (offer.monthlyTracking) {
                            const monthCount = progress.months ? progress.months.length : 1;
                            totalPotential += offer.maxBack * monthCount;
                        } else {
                            totalPotential += offer.maxBack;
                        }
                    }
                    // If no maxBack, we can't calculate a fixed potential
                } else {
                    totalPotential += offer.reward || 0;
                    if (offer.bonusReward) {
                        totalPotential += offer.bonusReward;
                    }
                }

                // Calculate earned amount
                let earned = 0;
                if (offer.monthlyTracking && progress.months) {
                    earned = Number(progress.months.reduce((sum, month) => sum + Number(month.earnedReward || 0), 0));
                    if (offer.bonusReward && progress.totalCompleted === progress.months.length) {
                        earned += Number(offer.bonusReward);
                    }
                } else if (progress.earnedReward) {
                    earned = Number(progress.earnedReward);
                }
                totalEarned += earned;

                // Determine tier badge
                const getTierBadge = (offer) => {
                    if (!offer.isComplete && !offer.expired && !offer.notStarted && !offer.currentMonthComplete) return { text: '🚨 URGENT', color: '#dc3545' };
                    if (offer.isComplete && !offer.expired) return { text: '✅ COMPLETED', color: '#28a745' };
                    if (!offer.isComplete && !offer.expired && !offer.notStarted && offer.currentMonthComplete) return { text: '⏳ LOWER PRIORITY', color: '#17a2b8' };
                    if (!offer.isComplete && !offer.expired && !offer.notStarted) return { text: '📅 CAN WAIT', color: '#6c757d' };
                    if (offer.isComplete && offer.expired) return { text: '🏆 ARCHIVED SUCCESS', color: '#6c757d' };
                    if (!offer.isComplete && offer.expired) return { text: '❌ MISSED', color: '#dc3545' };
                    if (offer.notStarted) return { text: '⏰ UPCOMING', color: '#17a2b8' };
                    return { text: 'UNKNOWN', color: '#6c757d' };
                };

                const tierBadge = getTierBadge(offer);

                // Render transactions in condensed format: Date - Merchant - Amount - Categories
                // Format date without timezone conversion
                const formatDate = (dateStr) => {
                    const [year, month, day] = dateStr.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    return date.toLocaleDateString();
                };

                const transactionsHtml = offer.transactions.length > 0 ? `
                    <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 5px;">
                        <strong style="font-size: 0.9em;">Qualifying Transactions (${offer.transactions.length}):</strong>
                        <div style="margin-top: 0.5rem; max-height: 150px; overflow-y: auto; font-size: 0.85em;">
                            ${offer.transactions.map(t => `
                                <div style="padding: 0.25rem 0; border-bottom: 1px solid var(--border-color);">
                                    ${formatDate(t.date)} • ${t.merchant} • <strong>$${t.amount.toFixed(2)}</strong>${t.categories && t.categories.length > 0 ? ` • ${t.categories.join(', ')}` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '<div style="margin-top: 0.75rem; padding: 0.5rem; background: #fff3cd; border-radius: 5px; color: #856404; font-size: 0.85em;"><em>No qualifying transactions yet</em></div>';

                return `
                    <div class="offer-card">
                        <div style="margin-bottom: 0.5rem;">
                            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <div class="offer-name" style="margin-bottom: 0.25rem; flex: 1 1 60%; min-width: 200px;">${offer.name}</div>
                                <div style="flex: 0 1 auto; text-align: right; white-space: nowrap;">
                                    <div style="font-size: 1.1em; font-weight: bold;">
                                        ${offer.type === 'percent-back' ?
                                            (offer.maxBack ?
                                                (offer.monthlyTracking && progress.months ?
                                                    `Max: $${offer.maxBack}/mo × ${progress.months.length} = $${(offer.maxBack * progress.months.length).toFixed(2)}` :
                                                    `Max: $${offer.maxBack}`) :
                                                `${offer.percentBack}% back`) :
                                            (offer.monthlyTracking && progress.months ?
                                                `$${offer.reward}/mo × ${progress.months.length}${offer.bonusReward ? ` + $${offer.bonusReward}` : ''} = $${(offer.reward * progress.months.length) + (offer.bonusReward || 0)}` :
                                                `$${offer.reward}${offer.bonusReward ? ` + $${offer.bonusReward}` : ''}`)
                                        }
                                    </div>
                                    <div style="font-size: 0.8em; color: var(--text-secondary);">Earned: $${Number(earned).toFixed(2)}</div>
                                </div>
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                                <span style="background: ${tierBadge.color}; color: white; padding: 0.2rem 0.5rem; border-radius: 3px; font-weight: bold; font-size: 0.75em;">
                                    ${tierBadge.text}
                                </span>
                                <span class="status-badge status-${progress.status}" style="font-size: 0.75em; padding: 0.2rem 0.5rem;">${progress.status.toUpperCase()}</span>
                                <span class="offer-type-badge" style="font-size: 0.75em; padding: 0.2rem 0.5rem;">${this.getOfferTypeLabel(offer)}</span>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85em; color: var(--text-secondary); margin-bottom: 0.5rem;">
                            <div>${offer.startDate.toLocaleDateString()} - ${offer.endDate.toLocaleDateString()}</div>
                            <div>${offer.expired ? `Expired ${Math.abs(offer.daysUntilExpiration)}d ago` :
                                  offer.notStarted ? `Starts in ${offer.daysUntilExpiration}d` :
                                  `${offer.daysUntilExpiration}d left`}</div>
                        </div>
                        <div style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 0.5rem;">${offer.description}</div>
                        ${offer.monthlyTracking ? this.renderMonthlyProgress(offer, progress) : this.renderSingleProgress(offer, progress)}
                        ${transactionsHtml}
                    </div>
                `;
            });

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
                <div style="margin-top: 2rem;">
                    <h2 style="color: #155724; margin-bottom: 1rem;">📊 Offers (Sorted by Priority)</h2>
                </div>
            `;

            // Show offers sorted by priority
            container.innerHTML = summary + offerCards.join('');

        } catch (error) {
            console.error('Error rendering dashboard:', error);
            container.innerHTML = `
                <div style="background: #f8d7da; padding: 1rem; border-radius: 5px; color: #721c24;">
                    Error loading dashboard. Please try again.
                </div>
            `;
        }
    }

    renderMonthlyProgress(offer, progress) {
        const today = new Date();

        const monthsHtml = progress.months.map(month => {
            let progressBarsHtml = '';
            let progressText = '';

            // Parse the month to check if it's expired
            const monthParts = month.month.split(' ');
            const monthName = monthParts[0];
            const year = monthParts[1] ? parseInt(monthParts[1]) : today.getFullYear();
            const monthDate = new Date(`${monthName} 1, ${year}`);
            const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);
            const isExpired = monthEnd < today && !month.completed;

            // Handle tiered offers
            if (offer.tiers && offer.tiers.length > 0) {
                const sortedTiers = [...offer.tiers].sort((a, b) => a.threshold - b.threshold);
                const value = offer.type === 'transactions' ? month.transactionCount : month.spending;
                const valueLabel = offer.type === 'transactions' ? 'txn' : '';

                progressBarsHtml = sortedTiers.map((tier, idx) => {
                    const percentage = Math.min((value / tier.threshold) * 100, 100);
                    const isReached = value >= tier.threshold;

                    return `
                        <div style="margin-bottom: 0.15rem;">
                            <div style="font-size: 0.65em; color: var(--text-secondary); margin-bottom: 0.1rem;">
                                T${idx + 1}: ${valueLabel ? `${tier.threshold} ${valueLabel}` : `$${tier.threshold}`} → $${tier.reward} ${isReached ? '✓' : ''}
                            </div>
                            <div class="offer-progress" style="height: 3px; background: var(--progress-bg);">
                                <div class="progress-bar" style="width: ${percentage}%; height: 3px;"></div>
                            </div>
                        </div>
                    `;
                }).join('');

                progressText = valueLabel ? `${value} ${valueLabel}` : `$${value.toFixed(0)}`;
            } else if (offer.type === 'percent-back') {
                const earnedReward = Number(month.earnedReward || 0);
                if (offer.maxBack) {
                    const percentage = Math.min((earnedReward / offer.maxBack) * 100, 100);
                    progressBarsHtml = `<div class="offer-progress" style="height: 4px; background: var(--progress-bg);">
                        <div class="progress-bar" style="width: ${percentage}%; height: 4px;"></div>
                    </div>`;
                    progressText = `$${earnedReward.toFixed(2)}/$${offer.maxBack}`;
                } else {
                    const percentage = month.spending > 0 ? 50 : 0;
                    progressBarsHtml = `<div class="offer-progress" style="height: 4px; background: var(--progress-bg);">
                        <div class="progress-bar" style="width: ${percentage}%; height: 4px;"></div>
                    </div>`;
                    progressText = `$${earnedReward.toFixed(2)} (${offer.percentBack}%)`;
                }
            } else if (offer.type === 'spending' && offer.spendingTarget) {
                const percentage = Math.min((month.spending / offer.spendingTarget) * 100, 100);
                progressBarsHtml = `<div class="offer-progress" style="height: 4px; background: var(--progress-bg);">
                    <div class="progress-bar" style="width: ${percentage}%; height: 4px;"></div>
                </div>`;
                progressText = `$${month.spending.toFixed(0)}/$${offer.spendingTarget}`;
            } else if (offer.type === 'transactions' && offer.transactionTarget) {
                const percentage = Math.min((month.transactionCount / offer.transactionTarget) * 100, 100);
                progressBarsHtml = `<div class="offer-progress" style="height: 4px; background: var(--progress-bg);">
                    <div class="progress-bar" style="width: ${percentage}%; height: 4px;"></div>
                </div>`;
                progressText = `${month.transactionCount}/${offer.transactionTarget}`;
            }

            // Determine status and background color
            let statusClass = 'status-active';
            let statusText = 'IN PROGRESS';
            let bgColor = 'var(--bg-secondary)';

            if (month.completed) {
                statusClass = 'status-completed';
                statusText = 'COMPLETED';
                bgColor = '#d4edda'; // Green
            } else if (month.partiallyCompleted) {
                statusClass = 'status-partial';
                statusText = 'PARTIAL';
                bgColor = '#fff3cd'; // Yellow
            } else if (isExpired) {
                statusClass = 'status-expired';
                statusText = 'EXPIRED';
                bgColor = '#f8d7da'; // Red
            }

            return `
                <div style="flex: 0 1 calc(33.333% - 0.5rem); min-width: 120px; max-width: 200px; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 5px; margin-right: 0.5rem; margin-bottom: 0.5rem; background: ${bgColor};">
                    <div style="font-size: 0.8em; font-weight: bold; margin-bottom: 0.25rem;">${monthName}</div>
                    <div style="margin-bottom: 0.25rem;">
                        ${progressBarsHtml}
                    </div>
                    <div style="font-size: 0.75em; color: var(--text-secondary); margin-bottom: 0.25rem;">${progressText}</div>
                    <div style="font-size: 0.7em;">
                        <span class="${statusClass}" style="padding: 0.1rem 0.3rem; font-size: 0.7em;">${statusText}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-top: 0.5rem;">
                <div style="display: flex; flex-wrap: wrap; margin-bottom: 0.5rem;">
                    ${monthsHtml}
                </div>
                <div style="font-size: 0.85em; color: var(--text-secondary);">
                    <strong>Completed:</strong> ${progress.totalCompleted} / ${progress.months.length} months
                </div>
            </div>
        `;
    }

    renderSingleProgress(offer, progress) {
        let progressText = '';
        let tierProgressHtml = '';

        // Handle tiered offers differently
        if (offer.tiers && offer.tiers.length > 0) {
            const sortedTiers = [...offer.tiers].sort((a, b) => a.threshold - b.threshold);
            const value = offer.type === 'transactions' ? progress.totalTransactions : progress.totalSpending;
            const valueLabel = offer.type === 'transactions' ? 'transactions' : '';

            // Find which tier was reached
            const tierReached = progress.tierReached;
            const tierIndex = tierReached ? sortedTiers.findIndex(t => t.threshold === tierReached.threshold) : -1;

            // Build tier progress display
            tierProgressHtml = sortedTiers.map((tier, idx) => {
                const percentage = Math.min((value / tier.threshold) * 100, 100);
                const isReached = value >= tier.threshold;
                const isCurrent = !isReached && (idx === 0 || value >= sortedTiers[idx - 1].threshold);

                let bgColor = 'var(--bg-secondary)';
                if (isReached && idx === sortedTiers.length - 1) {
                    bgColor = '#d4edda'; // Green for highest tier reached
                } else if (isReached) {
                    bgColor = '#fff3cd'; // Yellow for lower tier reached
                }

                return `
                    <div style="margin-bottom: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 5px; background: ${bgColor};">
                        <div style="font-size: 0.85em; margin-bottom: 0.25rem;">
                            <strong>Tier ${idx + 1}:</strong> ${valueLabel ? `${value}/${tier.threshold} ${valueLabel}` : `$${value.toFixed(2)}/$${tier.threshold}`}
                            → <strong>$${tier.reward}</strong> ${isReached ? '✓' : ''}
                        </div>
                        <div class="offer-progress" style="height: 6px; background: var(--progress-bg);">
                            <div class="progress-bar" style="width: ${percentage}%; height: 6px;"></div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div style="margin-top: 0.5rem;">
                    ${tierProgressHtml}
                </div>
            `;
        } else {
            // Non-tiered offers
            if (offer.type === 'percent-back') {
                const earnedReward = Number(progress.earnedReward || 0);
                if (offer.maxBack) {
                    progressText = `$${earnedReward.toFixed(2)} / $${offer.maxBack} max back`;
                } else {
                    progressText = `$${earnedReward.toFixed(2)} earned (${offer.percentBack}% of $${progress.totalSpending.toFixed(2)})`;
                }
            } else if (offer.type === 'spending' && offer.spendingTarget) {
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
    }

    async renderTransactions() {
        const container = document.getElementById('transaction-list');
        const transactions = await this.dataManager.getTransactions();

        if (transactions.length === 0) {
            container.innerHTML = '<p>No transactions yet. Add your first transaction above!</p>';
            return;
        }

        // Calculate pagination
        const totalPages = Math.ceil(transactions.length / this.transactionsPerPage);
        const startIndex = (this.currentTransactionPage - 1) * this.transactionsPerPage;
        const endIndex = startIndex + this.transactionsPerPage;
        const paginatedTransactions = transactions.slice(startIndex, endIndex);

        const transactionHtml = await Promise.all(paginatedTransactions.map(async transaction => {
            const matchingOffers = await this.dataManager.getMatchingOffersForTransaction(transaction);
            const matchingOffersHtml = matchingOffers.length > 0
                ? `<div style="margin-top: 0.25rem;">${matchingOffers.map(o => `<div style="font-size: 0.8rem; color: #28a745; margin-left: 1rem; padding: 0.15rem 0;">↳ ${o.name}</div>`).join('')}</div>`
                : '';

            // Format date without timezone conversion - just parse YYYY-MM-DD and display
            const formatDate = (dateStr) => {
                const [year, month, day] = dateStr.split('-').map(Number);
                const date = new Date(year, month - 1, day);
                return date.toLocaleDateString();
            };

            return `
                <div class="transaction-item" style="padding: 0.5rem 1rem; margin-bottom: 0.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; font-size: 0.9rem;">
                            ${formatDate(transaction.date)} • <strong>${transaction.merchant}</strong> • $${transaction.amount.toFixed(2)}${(transaction.categories || []).length > 0 ? ` • ${transaction.categories.join(', ')}` : ''}
                        </div>
                        <div style="white-space: nowrap; margin-left: 1rem;">
                            <button class="btn-secondary" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="tracker.editTransaction(${transaction.id})">Edit</button>
                            <button class="btn-danger" style="padding: 0.2rem 0.4rem; font-size: 0.75rem;" onclick="tracker.deleteTransaction(${transaction.id})">Delete</button>
                        </div>
                    </div>
                    ${matchingOffersHtml}
                </div>
            `;
        }));

        // Add pagination controls
        const paginationHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 5px;">
                <div style="font-size: 0.9rem;">
                    Showing ${startIndex + 1}-${Math.min(endIndex, transactions.length)} of ${transactions.length} transactions
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;"
                        onclick="tracker.goToTransactionPage(${this.currentTransactionPage - 1})"
                        ${this.currentTransactionPage === 1 ? 'disabled' : ''}>
                        Previous
                    </button>
                    <span style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                        Page ${this.currentTransactionPage} of ${totalPages}
                    </span>
                    <button class="btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;"
                        onclick="tracker.goToTransactionPage(${this.currentTransactionPage + 1})"
                        ${this.currentTransactionPage === totalPages ? 'disabled' : ''}>
                        Next
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = transactionHtml.join('') + paginationHtml;
    }

    async goToTransactionPage(page) {
        const transactions = await this.dataManager.getTransactions();
        const totalPages = Math.ceil(transactions.length / this.transactionsPerPage);

        if (page >= 1 && page <= totalPages) {
            this.currentTransactionPage = page;
            await this.renderTransactions();
        }
    }

    async renderOffers() {
        const container = document.getElementById('offer-list');
        let offers = await this.dataManager.getOffers();

        if (offers.length === 0) {
            container.innerHTML = '<p>No offers yet. Add your first offer above!</p>';
            return;
        }

        // Sort offers: active first, then expired
        const today = new Date();
        offers.sort((a, b) => {
            const aEnd = new Date(a.endDate + 'T23:59:59');
            const bEnd = new Date(b.endDate + 'T23:59:59');
            const aExpired = today > aEnd;
            const bExpired = today > bEnd;

            // Active before expired
            if (!aExpired && bExpired) return -1;
            if (aExpired && !bExpired) return 1;

            // Within same status, sort by end date
            return aEnd - bEnd;
        });

        const offersHtml = await Promise.all(offers.map(async offer => {
            const progress = await this.dataManager.calculateOfferProgress(offer);

            // Format tier targets for display
            let tierTargetDisplay = '';
            if (offer.tiers && offer.tiers.length > 0) {
                const sortedTiers = [...offer.tiers].sort((a, b) => a.threshold - b.threshold);
                tierTargetDisplay = sortedTiers.map(t => `$${t.threshold}`).join('/');
            } else if (offer.spendingTarget) {
                tierTargetDisplay = `$${offer.spendingTarget}`;
            }

            // Format tier rewards for display
            let tierRewardsDisplay = '';
            if (offer.tiers && offer.tiers.length > 0) {
                const sortedTiers = [...offer.tiers].sort((a, b) => a.threshold - b.threshold);
                tierRewardsDisplay = `
                    <div style="font-size: 0.85em; color: #666; margin-top: 0.25rem;">
                        <strong>Tier Rewards:</strong>
                        ${sortedTiers.map(t => `<div style="margin-left: 1rem;">• Spend $${t.threshold} → Earn $${t.reward}</div>`).join('')}
                    </div>
                `;
            }

            return `
                <div class="offer-card" style="padding: 1rem; margin-bottom: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <div style="flex: 1 1 60%; min-width: 200px;">
                            <div class="offer-name" style="margin-bottom: 0.25rem;">${offer.name}</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <span class="status-badge status-${progress.status}" style="font-size: 0.75em; padding: 0.2rem 0.5rem;">${progress.status.toUpperCase()}</span>
                                <span class="offer-type-badge" style="font-size: 0.75em; padding: 0.2rem 0.5rem;">${this.getOfferTypeLabel(offer)}</span>
                            </div>
                        </div>
                        <div style="flex: 0 1 auto; text-align: right; white-space: nowrap;">
                            <div style="font-size: 1.1em; font-weight: bold;">
                                ${offer.type === 'percent-back' ?
                                    (offer.monthlyTracking && progress.months ?
                                        `$${Number(progress.months.reduce((sum, m) => sum + Number(m.earnedReward || 0), 0)).toFixed(2)} earned` :
                                        `$${Number(progress.earnedReward || 0).toFixed(2)} earned`) :
                                    (offer.monthlyTracking && progress.months ?
                                        `$${offer.reward || 0}/mo × ${progress.months.length}${offer.bonusReward ? ` + $${offer.bonusReward}` : ''} = $${((offer.reward || 0) * progress.months.length) + (offer.bonusReward || 0)}` :
                                        `$${offer.reward || 0}${offer.bonusReward ? ` + $${offer.bonusReward}` : ''}`)
                                }
                            </div>
                            ${tierRewardsDisplay}
                        </div>
                    </div>
                    <div style="font-size: 0.85em; color: #666; margin-bottom: 0.5rem;">
                        ${new Date(offer.startDate + 'T00:00:00').toLocaleDateString()} - ${new Date(offer.endDate + 'T00:00:00').toLocaleDateString()}
                        ${offer.type === 'percent-back' ?
                            `${offer.percentBack ? ` • ${offer.percentBack}% back` : ''}${offer.maxBack ? ` • Max: $${offer.maxBack}${offer.monthlyTracking ? '/month' : ''}` : ''}${offer.minSpendThreshold ? ` • Min spend: $${offer.minSpendThreshold}${offer.monthlyTracking ? '/month' : ''}` : ''}` :
                            `${tierTargetDisplay ? ` • Target: ${tierTargetDisplay}` : ''}${offer.transactionTarget ? ` • ${offer.transactionTarget} transactions` : ''}${offer.minTransaction ? ` • Min: $${offer.minTransaction}` : ''}`
                        }
                        ${offer.categories && offer.categories.length > 0 ? ` • ${offer.categories.join(', ')}` : ''}
                    </div>
                    <div style="font-size: 0.9em; color: #666; margin-bottom: 0.5rem;">${offer.description}</div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.85em;" onclick="tracker.editOffer(${offer.id})">Edit</button>
                        <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.85em;" onclick="tracker.copyOffer(${offer.id})">Copy to...</button>
                        <button class="btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.85em;" onclick="tracker.deleteOffer(${offer.id})">Delete</button>
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

    async copyOffer(id) {
        try {
            // Get the offer data
            const offer = await this.dataManager.getOffer(id);
            if (!offer) {
                alert('Failed to load offer');
                return;
            }

            // Get all people except current person
            const allPeople = await this.dataManager.dbManager.getPeople();
            const currentPersonId = parseInt(this.dataManager.dbManager.currentPersonId);
            const otherPeople = allPeople.filter(p => p.id !== currentPersonId);

            if (otherPeople.length === 0) {
                alert('No other card holders to copy to. Add another card holder first.');
                return;
            }

            // Create a simple selection dialog
            const peopleOptions = otherPeople.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
            const selection = prompt(`Copy "${offer.name}" to which card holder?\n\n${peopleOptions}\n\nEnter the number:`);

            if (!selection) {
                return; // User cancelled
            }

            const selectedIndex = parseInt(selection) - 1;
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= otherPeople.length) {
                alert('Invalid selection');
                return;
            }

            const targetPerson = otherPeople[selectedIndex];

            // Create a copy of the offer with new person_id
            const offerCopy = {
                name: offer.name,
                type: offer.type,
                startDate: offer.startDate,
                endDate: offer.endDate,
                monthlyTracking: offer.monthlyTracking,
                spendingTarget: offer.spendingTarget,
                transactionTarget: offer.transactionTarget,
                minTransaction: offer.minTransaction,
                categories: offer.categories,
                reward: offer.reward,
                bonusReward: offer.bonusReward,
                tiers: offer.tiers,
                description: offer.description,
                personId: targetPerson.id
            };

            // Save the copied offer
            await this.dataManager.dbManager.addOffer(offerCopy);

            alert(`Successfully copied "${offer.name}" to ${targetPerson.name}`);
        } catch (error) {
            console.error('Error copying offer:', error);
            alert('Failed to copy offer: ' + error.message);
        }
    }

    getOfferTypeLabel(offer) {
        let label = '';

        // Determine base type
        if (offer.type === 'percent-back') {
            label = offer.monthlyTracking ? 'Monthly Percent Back' : 'Percent Back';
        } else if (offer.type === 'spending' && offer.spendingTarget) {
            if (offer.monthlyTracking) {
                label = 'Monthly Spending';
                if (offer.bonusReward) {
                    label += ' + Completion Bonus';
                }
            } else {
                label = (offer.categories && offer.categories.length > 0) ? 'Category Spending' : 'Total Spending';
            }
        } else if (offer.type === 'transactions' && offer.transactionTarget) {
            if (offer.monthlyTracking) {
                label = 'Monthly Purchase Count';
            } else {
                label = (offer.categories && offer.categories.length > 0) ? 'Category Purchase Count' : 'Total Purchase Count';
            }
        } else if (offer.type === 'combo') {
            label = 'Combination Offer';
        }

        // Add categories if specified
        if (offer.categories && offer.categories.length > 0 && !label.includes('Category')) {
            const categoryNames = offer.categories.map(cat => cat.charAt(0).toUpperCase() + cat.slice(1)).join(', ');
            label += ` (${categoryNames})`;
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