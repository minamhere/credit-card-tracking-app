// Shared Data Manager with SQLite
// This file contains the reusable data management logic using SQLite database
// This file can be shared across users - personal data is kept separate

class DataManager {
    constructor() {
        this.dbManager = new DatabaseManager();
        this.initialized = false;
    }

    async initialize() {
        if (!this.initialized) {
            await this.dbManager.initialize();
            this.initialized = true;
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    // Offers methods
    async getOffers() {
        await this.ensureInitialized();
        return this.dbManager.getOffers();
    }

    async addOffer(offerData) {
        await this.ensureInitialized();
        return this.dbManager.addOffer(offerData);
    }

    async updateOffer(id, offerData) {
        await this.ensureInitialized();
        return this.dbManager.updateOffer(id, offerData);
    }

    async deleteOffer(id) {
        await this.ensureInitialized();
        return this.dbManager.deleteOffer(id);
    }

    async getOffer(id) {
        await this.ensureInitialized();
        return this.dbManager.getOffer(id);
    }

    // Transactions methods
    async getTransactions() {
        await this.ensureInitialized();
        return this.dbManager.getTransactions();
    }

    async addTransaction(transactionData) {
        await this.ensureInitialized();
        return this.dbManager.addTransaction(transactionData);
    }

    async updateTransaction(id, transactionData) {
        await this.ensureInitialized();
        return this.dbManager.updateTransaction(id, transactionData);
    }

    async deleteTransaction(id) {
        await this.ensureInitialized();
        return this.dbManager.deleteTransaction(id);
    }

    // Export/Import methods
    async exportDatabase() {
        await this.ensureInitialized();
        return this.dbManager.exportDatabase();
    }

    async importDatabase(file) {
        await this.ensureInitialized();
        return this.dbManager.importDatabase(file);
    }

    // Helper function to determine which tier is reached based on spending/transactions
    getTierReached(offer, spending, transactionCount) {
        if (!offer.tiers || offer.tiers.length === 0) {
            return null;
        }

        // Sort tiers by threshold descending to find highest tier reached
        const sortedTiers = [...offer.tiers].sort((a, b) => b.threshold - a.threshold);

        const value = offer.type === 'transactions' ? transactionCount : spending;

        for (const tier of sortedTiers) {
            if (value >= tier.threshold) {
                return tier;
            }
        }

        return null;
    }

    // Progress calculation (same logic as before but with async data loading)
    async calculateOfferProgress(offer) {
        // Use local time consistently - parse date strings as local dates
        const startDate = new Date(offer.startDate + 'T00:00:00');
        const endDate = new Date(offer.endDate + 'T23:59:59');
        const today = new Date();

        const isActive = today >= startDate && today <= endDate;
        const isExpired = today > endDate;
        const status = isExpired ? 'expired' : (isActive ? 'active' : 'upcoming');


        const transactions = await this.getTransactions();
        let eligibleTransactions = transactions.filter(t => {
            // Parse transaction date as local time
            const transactionDate = new Date(t.date + 'T12:00:00');
            const isInDateRange = transactionDate >= startDate && transactionDate <= endDate;

            // Check category match - if offer has categories, transaction must have at least one matching category
            const isCategoryMatch = !offer.categories || offer.categories.length === 0 ||
                (t.categories && t.categories.some(transactionCat =>
                    offer.categories.includes(transactionCat)));

            const isMinAmountMet = !offer.minTransaction || t.amount >= offer.minTransaction;

            return isInDateRange && isCategoryMatch && isMinAmountMet;
        });

        if (offer.monthlyTracking) {
            const months = [];

            // Start from the first day of the start month
            let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
            const endOfLastMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0);

            while (currentDate <= endOfLastMonth) {
                const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

                const monthTransactions = eligibleTransactions.filter(t => {
                    // Parse transaction date as local time
                    const transactionDate = new Date(t.date + 'T12:00:00');
                    const inMonth = transactionDate >= monthStart && transactionDate <= monthEnd;
                    return inMonth;
                });

                const monthSpending = monthTransactions.reduce((sum, t) => sum + t.amount, 0);
                const monthTransactionCount = monthTransactions.length;

                let monthCompleted = false;
                let tierReached = null;
                let earnedReward = 0;

                // Check if offer uses tiers
                if (offer.tiers && offer.tiers.length > 0) {
                    tierReached = this.getTierReached(offer, monthSpending, monthTransactionCount);
                    if (tierReached) {
                        monthCompleted = true;
                        earnedReward = tierReached.reward;
                    }
                } else {
                    // Use traditional completion logic
                    if (offer.type === 'spending' && offer.spendingTarget) {
                        monthCompleted = monthSpending >= offer.spendingTarget;
                        earnedReward = monthCompleted ? offer.reward : 0;
                    } else if (offer.type === 'transactions' && offer.transactionTarget) {
                        monthCompleted = monthTransactionCount >= offer.transactionTarget;
                        earnedReward = monthCompleted ? offer.reward : 0;
                    }
                }

                months.push({
                    month: monthStart.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    spending: monthSpending,
                    transactionCount: monthTransactionCount,
                    completed: monthCompleted,
                    tierReached: tierReached,
                    earnedReward: earnedReward
                });

                // Move to next month
                currentDate.setMonth(currentDate.getMonth() + 1);
            }

            return {
                status,
                months,
                totalCompleted: months.filter(m => m.completed).length,
                totalSpending: eligibleTransactions.reduce((sum, t) => sum + t.amount, 0),
                totalTransactions: eligibleTransactions.length
            };
        } else {
            const totalSpending = eligibleTransactions.reduce((sum, t) => sum + t.amount, 0);
            const totalTransactions = eligibleTransactions.length;

            let completed = false;
            let progress = 0;
            let tierReached = null;
            let earnedReward = 0;

            // Check if offer uses tiers
            if (offer.tiers && offer.tiers.length > 0) {
                tierReached = this.getTierReached(offer, totalSpending, totalTransactions);
                if (tierReached) {
                    completed = true;
                    earnedReward = tierReached.reward;
                    // Calculate progress to highest tier
                    const highestTier = [...offer.tiers].sort((a, b) => b.threshold - a.threshold)[0];
                    const value = offer.type === 'transactions' ? totalTransactions : totalSpending;
                    progress = Math.min((value / highestTier.threshold) * 100, 100);
                }
            } else {
                // Traditional logic
                if (offer.type === 'spending' && offer.spendingTarget) {
                    progress = Math.min((totalSpending / offer.spendingTarget) * 100, 100);
                    completed = totalSpending >= offer.spendingTarget;
                    earnedReward = completed ? offer.reward : 0;
                } else if (offer.type === 'transactions' && offer.transactionTarget) {
                    progress = Math.min((totalTransactions / offer.transactionTarget) * 100, 100);
                    completed = totalTransactions >= offer.transactionTarget;
                    earnedReward = completed ? offer.reward : 0;
                }
            }

            return {
                status,
                completed,
                progress,
                totalSpending,
                totalTransactions,
                tierReached,
                earnedReward
            };
        }
    }

    // Merchant autocomplete methods
    async getUniqueMerchants() {
        await this.ensureInitialized();
        return this.dbManager.getUniqueMerchants();
    }

    async getMostCommonCategoryForMerchant(merchant) {
        await this.ensureInitialized();
        return this.dbManager.getMostCommonCategoryForMerchant(merchant);
    }

    async getMatchingOffersForTransaction(transaction) {
        await this.ensureInitialized();
        const offers = await this.getOffers();
        const matchingOffers = [];

        for (const offer of offers) {
            const startDate = new Date(offer.startDate + 'T00:00:00');
            const endDate = new Date(offer.endDate + 'T23:59:59');
            const transactionDate = new Date(transaction.date + 'T12:00:00');

            // Check if transaction is within offer date range
            const isInDateRange = transactionDate >= startDate && transactionDate <= endDate;

            // Check category match - if offer has categories, transaction must have at least one matching category
            const isCategoryMatch = !offer.categories || offer.categories.length === 0 ||
                (transaction.categories && transaction.categories.some(transactionCat =>
                    offer.categories.includes(transactionCat)));

            // Check minimum transaction amount
            const isMinAmountMet = !offer.minTransaction || transaction.amount >= offer.minTransaction;

            if (isInDateRange && isCategoryMatch && isMinAmountMet) {
                matchingOffers.push(offer);
            }
        }

        return matchingOffers;
    }

    // Optimal spending recommendations
    async getOptimalSpendingRecommendations() {
        try {
            await this.ensureInitialized();
            const offers = await this.getOffers();
            const transactions = await this.getTransactions();
            const today = new Date();

        // Filter for active, incomplete offers (be more lenient for debugging)
        const activeOffers = [];
        for (const offer of offers) {
            const progress = await this.calculateOfferProgress(offer);
            const startDate = new Date(offer.startDate + 'T00:00:00');
            const endDate = new Date(offer.endDate + 'T23:59:59');

            // Include active/upcoming offers that aren't fully completed
            const isEligible = (progress.status === 'active' || progress.status === 'upcoming') && (
                progress.completed !== true ||
                (offer.monthlyTracking && progress.months && progress.months.some(month => !month.completed))
            );

            if (isEligible) {
                activeOffers.push({
                    ...offer,
                    progress,
                    startDate,
                    endDate
                });
            }
        }

        if (activeOffers.length === 0) {
            return { recommendations: [], overlaps: [], masterStrategy: null };
        }

            // Find overlapping periods and offers
            const overlaps = this.findOfferOverlaps(activeOffers, today);
            const recommendations = await this.generateSpendingRecommendations(overlaps, activeOffers, today);

            // Generate master strategy for dashboard
            const masterStrategy = await this.generateMasterStrategy(activeOffers, overlaps, today);

            return { recommendations, overlaps, masterStrategy };
        } catch (error) {
            console.error('Error in getOptimalSpendingRecommendations:', error);
            throw error;
        }
    }

    findOfferOverlaps(offers, today) {
        const overlaps = [];

        // Find all possible combinations (2, 3, 4+ offers)
        const combinations = this.generateOfferCombinations(offers);

        for (const combo of combinations) {
            // Find overlapping date range for all offers in combination
            const startDates = combo.map(offer => Math.max(offer.startDate, today));
            const endDates = combo.map(offer => offer.endDate);

            const overlapStart = new Date(Math.max(...startDates));
            const overlapEnd = new Date(Math.min(...endDates));

            if (overlapStart <= overlapEnd) {
                // Check if all offers in combination can work together
                const compatibility = this.canOffersOverlapMultiple(combo);

                if (compatibility) {
                    overlaps.push({
                        offers: combo,
                        startDate: overlapStart,
                        endDate: overlapEnd,
                        compatibility,
                        offerCount: combo.length
                    });
                }
            }
        }

        // Sort by number of offers (prioritize multi-offer combinations)
        overlaps.sort((a, b) => b.offerCount - a.offerCount);

        return overlaps;
    }

    generateOfferCombinations(offers) {
        const combinations = [];

        // Generate all possible combinations of 2+ offers
        for (let size = 2; size <= offers.length; size++) {
            const combos = this.getCombinations(offers, size);
            combinations.push(...combos);
        }

        return combinations;
    }

    getCombinations(array, size) {
        if (size === 1) return array.map(item => [item]);
        if (size > array.length) return [];

        const combinations = [];
        for (let i = 0; i <= array.length - size; i++) {
            const head = array[i];
            const tail = this.getCombinations(array.slice(i + 1), size - 1);
            for (const combo of tail) {
                combinations.push([head, ...combo]);
            }
        }

        return combinations;
    }

    canOffersOverlapMultiple(offers) {
        const compatibility = {
            categories: [],
            minTransaction: 0,
            reasons: [],
            isCompatible: true
        };

        // Find category requirements - now handling categories as arrays
        const offersWithCategories = offers.filter(offer => offer.categories && offer.categories.length > 0);

        if (offersWithCategories.length === 0) {
            // No category requirements - all categories work
            compatibility.categories = [];
            compatibility.reasons.push('Any category accepted by all offers');
        } else {
            // Find intersection of all category requirements
            // Transactions matching ANY category in the intersection will satisfy all offers
            const categorySets = offersWithCategories.map(offer => new Set(offer.categories));

            // Start with first offer's categories
            const intersection = new Set(categorySets[0]);

            // Find categories that appear in at least one offer (union logic)
            // Since offers can have multiple categories, a transaction can match any of them
            const allCategories = new Set();
            offersWithCategories.forEach(offer => {
                offer.categories.forEach(cat => allCategories.add(cat));
            });

            compatibility.categories = Array.from(allCategories);

            if (compatibility.categories.length > 0) {
                compatibility.reasons.push(`Accepted categories: ${compatibility.categories.join(', ')}`);
            } else {
                compatibility.isCompatible = false;
                return null;
            }
        }

        // Find highest minimum transaction requirement
        compatibility.minTransaction = Math.max(...offers.map(offer => offer.minTransaction || 0));
        if (compatibility.minTransaction > 0) {
            compatibility.reasons.push(`Minimum transaction: $${compatibility.minTransaction}`);
        }

        return compatibility;
    }

    canOffersOverlap(offer1, offer2) {
        const compatibility = {
            categories: [],
            minTransaction: 0,
            reasons: []
        };

        // Check category compatibility - now handling categories as arrays
        const has1 = offer1.categories && offer1.categories.length > 0;
        const has2 = offer2.categories && offer2.categories.length > 0;

        if (!has1 && !has2) {
            compatibility.categories = [];
            compatibility.reasons.push('Both offers accept any category');
        } else if (!has1) {
            compatibility.categories = offer2.categories;
            compatibility.reasons.push(`Use ${offer2.categories.join(', ')} (required by ${offer2.name})`);
        } else if (!has2) {
            compatibility.categories = offer1.categories;
            compatibility.reasons.push(`Use ${offer1.categories.join(', ')} (required by ${offer1.name})`);
        } else {
            // Both have category requirements - find union of categories
            // Transactions matching any of these categories will count towards both
            const allCategories = new Set([...offer1.categories, ...offer2.categories]);
            compatibility.categories = Array.from(allCategories);
            compatibility.reasons.push(`Use ${compatibility.categories.join(', ')} categories`);
        }

        // Check minimum transaction requirements
        compatibility.minTransaction = Math.max(
            offer1.minTransaction || 0,
            offer2.minTransaction || 0
        );

        if (compatibility.minTransaction > 0) {
            compatibility.reasons.push(`Minimum transaction: $${compatibility.minTransaction}`);
        }

        return compatibility;
    }

    async generateSpendingRecommendations(overlaps, allOffers, today) {
        const recommendations = [];

        // Generate recommendations for each overlap
        for (const overlap of overlaps) {
            const offers = overlap.offers;
            const comp = overlap.compatibility;

            // Calculate remaining needs for each offer (use existing progress data)
            const remainingNeeds = await Promise.all(
                offers.map(offer => this.calculateRemainingNeedsWithProgress(offer, offer.progress, overlap.startDate, overlap.endDate))
            );

            if (remainingNeeds.some(need => need.needed)) {
                const rec = {
                    title: offers.length > 2 ?
                        `Multi-Offer Opportunity: ${offers.slice(0, 2).map(o => o.name).join(' + ')} + ${offers.length - 2} more` :
                        `Overlap Opportunity: ${offers.map(o => o.name).join(' + ')}`,
                    priority: offers.length > 2 ? 'ultra-high' : 'high',
                    period: `${overlap.startDate.toLocaleDateString()} - ${overlap.endDate.toLocaleDateString()}`,
                    category: (comp.categories && comp.categories.length > 0) ? comp.categories.join(', ') : 'any',
                    minTransaction: comp.minTransaction,
                    offers: offers.map(o => o.name),
                    offerIds: offers.map(o => o.id), // Store IDs for subset detection
                    strategy: this.generateDetailedOptimalStrategy(offers, remainingNeeds, comp, overlap.startDate, overlap.endDate),
                    savings: this.calculateMultiOfferSavings(remainingNeeds, offers),
                    offerCount: offers.length
                };

                recommendations.push(rec);
            }
        }

        // Filter out recommendations that are subsets of larger recommendations
        // This ensures we only show the maximal (largest) combinations for minimum spending
        const filteredRecommendations = recommendations.filter(rec => {
            // Check if there's a larger recommendation that contains all of rec's offers
            const isSubset = recommendations.some(other => {
                if (other === rec) return false; // Don't compare to itself
                if (other.offerCount <= rec.offerCount) return false; // Only check larger combinations

                // Check if rec's offers are a subset of other's offers
                return rec.offerIds.every(offerId => other.offerIds.includes(offerId));
            });

            return !isSubset; // Keep recommendations that are NOT subsets
        });

        // Add individual offer recommendations for offers not included in any overlap
        for (const offer of allOffers) {
            // Check if this offer appears in any of the filtered recommendations
            const inFilteredRecs = filteredRecommendations.some(rec =>
                rec.offerIds && rec.offerIds.includes(offer.id)
            );

            if (!inFilteredRecs) {
                const remaining = await this.calculateRemainingNeedsWithProgress(offer, offer.progress, today, offer.endDate);
                if (remaining.needed) {
                    filteredRecommendations.push({
                        title: `Complete: ${offer.name}`,
                        priority: 'medium',
                        period: `Now - ${offer.endDate.toLocaleDateString()}`,
                        category: (offer.categories && offer.categories.length > 0) ? offer.categories.join(', ') : 'any',
                        minTransaction: offer.minTransaction || 0,
                        offers: [offer.name],
                        offerIds: [offer.id],
                        strategy: this.generateSingleOfferStrategy(remaining, offer),
                        savings: null,
                        offerCount: 1
                    });
                }
            }
        }

        // Sort by priority (ultra-high > high > medium) and offer count
        filteredRecommendations.sort((a, b) => {
            const priorityOrder = { 'ultra-high': 3, 'high': 2, 'medium': 1 };
            const aPriority = priorityOrder[a.priority] || 0;
            const bPriority = priorityOrder[b.priority] || 0;

            if (aPriority !== bPriority) return bPriority - aPriority;
            if (a.offerCount && b.offerCount) return b.offerCount - a.offerCount;
            if (a.savings && b.savings) return b.savings.dollarsSaved - a.savings.dollarsSaved;
            return 0;
        });

        return filteredRecommendations;
    }

    async calculateRemainingNeeds(offer, periodStart, periodEnd) {
        const needs = {
            needed: false,
            spendingRemaining: 0,
            transactionsRemaining: 0,
            type: offer.type,
            monthlyBreakdown: []
        };

        // Get fresh progress data for this offer
        const progress = await this.calculateOfferProgress(offer);

        if (offer.monthlyTracking) {
            // For monthly tracking, analyze each month within the overlap period
            if (progress.months) {
                const today = new Date();

                progress.months.forEach(month => {
                    // Parse the month to get start/end dates

                    // Try to parse the month string (e.g., "October 2025")
                    const monthParts = month.month.split(' ');
                    const monthName = monthParts[0];
                    const year = monthParts[1] ? parseInt(monthParts[1]) : new Date().getFullYear();

                    const monthDate = new Date(`${monthName} 1, ${year}`);
                    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);


                    // Check if this month overlaps with our period and is not completed
                    const overlapStart = new Date(Math.max(monthStart, periodStart));
                    const overlapEnd = new Date(Math.min(monthEnd, periodEnd));

                    if (overlapStart <= overlapEnd && !month.completed) {
                        // This month is relevant and not completed
                        const monthNeeds = {
                            month: month.month,
                            monthStart: overlapStart,
                            monthEnd: overlapEnd,
                            spendingRemaining: 0,
                            transactionsRemaining: 0,
                            daysRemaining: Math.max(0, Math.ceil((overlapEnd - today) / (1000 * 60 * 60 * 24))),
                            dateRange: this.formatDateRange(overlapStart, overlapEnd)
                        };

                        if (offer.type === 'spending' && offer.spendingTarget) {
                            monthNeeds.spendingRemaining = Math.max(0, offer.spendingTarget - month.spending);
                            needs.spendingRemaining += monthNeeds.spendingRemaining;
                        }

                        if (offer.type === 'transactions' && offer.transactionTarget) {
                            monthNeeds.transactionsRemaining = Math.max(0, offer.transactionTarget - month.transactionCount);
                            needs.transactionsRemaining += monthNeeds.transactionsRemaining;
                        }

                        if (monthNeeds.spendingRemaining > 0 || monthNeeds.transactionsRemaining > 0) {
                            needs.monthlyBreakdown.push(monthNeeds);
                            needs.needed = true;
                        }
                    }
                });
            }
        } else {
            // For non-monthly tracking, check if offer overlaps with period and is not completed
            const offerStart = new Date(offer.startDate + 'T00:00:00');
            const offerEnd = new Date(offer.endDate + 'T23:59:59');
            const overlapStart = new Date(Math.max(offerStart, periodStart));
            const overlapEnd = new Date(Math.min(offerEnd, periodEnd));

            if (overlapStart <= overlapEnd && progress.completed !== true) {
                needs.needed = true;

                if (offer.type === 'spending' && offer.spendingTarget) {
                    needs.spendingRemaining = Math.max(0, offer.spendingTarget - (progress.totalSpending || 0));
                }

                if (offer.type === 'transactions' && offer.transactionTarget) {
                    needs.transactionsRemaining = Math.max(0, offer.transactionTarget - (progress.totalTransactions || 0));
                }
            }
        }

        return needs;
    }

    calculateRemainingNeedsWithProgress(offer, progress, periodStart, periodEnd) {
        const needs = {
            needed: false,
            spendingRemaining: 0,
            transactionsRemaining: 0,
            type: offer.type,
            monthlyBreakdown: []
        };


        if (offer.monthlyTracking) {
            // For monthly tracking, analyze each month within the overlap period
            if (progress.months) {
                const today = new Date();

                progress.months.forEach(month => {
                    // Parse the month to get start/end dates

                    // Try to parse the month string (e.g., "October 2025")
                    const monthParts = month.month.split(' ');
                    const monthName = monthParts[0];
                    const year = monthParts[1] ? parseInt(monthParts[1]) : new Date().getFullYear();

                    const monthDate = new Date(`${monthName} 1, ${year}`);
                    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);


                    // Check if this month overlaps with our period and is not completed
                    const overlapStart = new Date(Math.max(monthStart, periodStart));
                    const overlapEnd = new Date(Math.min(monthEnd, periodEnd));

                    if (overlapStart <= overlapEnd && !month.completed) {
                        // This month is relevant and not completed
                        const monthNeeds = {
                            month: month.month,
                            monthStart: overlapStart,
                            monthEnd: overlapEnd,
                            spendingRemaining: 0,
                            transactionsRemaining: 0,
                            daysRemaining: Math.max(0, Math.ceil((overlapEnd - today) / (1000 * 60 * 60 * 24))),
                            dateRange: this.formatDateRange(overlapStart, overlapEnd)
                        };

                        if (offer.type === 'spending' && offer.spendingTarget) {
                            monthNeeds.spendingRemaining = Math.max(0, offer.spendingTarget - month.spending);
                            needs.spendingRemaining += monthNeeds.spendingRemaining;
                        }

                        if (offer.type === 'transactions' && offer.transactionTarget) {
                            monthNeeds.transactionsRemaining = Math.max(0, offer.transactionTarget - month.transactionCount);
                            needs.transactionsRemaining += monthNeeds.transactionsRemaining;
                        }

                        if (monthNeeds.spendingRemaining > 0 || monthNeeds.transactionsRemaining > 0) {
                            needs.monthlyBreakdown.push(monthNeeds);
                            needs.needed = true;
                        }
                    }
                });
            }
        } else {
            // For non-monthly tracking, check if offer overlaps with period and is not completed
            const offerStart = new Date(offer.startDate + 'T00:00:00');
            const offerEnd = new Date(offer.endDate + 'T23:59:59');
            const overlapStart = new Date(Math.max(offerStart, periodStart));
            const overlapEnd = new Date(Math.min(offerEnd, periodEnd));

            if (overlapStart <= overlapEnd && progress.completed !== true) {
                needs.needed = true;

                if (offer.type === 'spending' && offer.spendingTarget) {
                    needs.spendingRemaining = Math.max(0, offer.spendingTarget - (progress.totalSpending || 0));
                }

                if (offer.type === 'transactions' && offer.transactionTarget) {
                    needs.transactionsRemaining = Math.max(0, offer.transactionTarget - (progress.totalTransactions || 0));
                }
            }
        }

        return needs;
    }

    generateOptimalStrategy(needs1, needs2, compatibility) {
        const strategies = [];

        if (needs1.type === 'spending' && needs2.type === 'spending') {
            const totalNeeded = Math.max(needs1.spendingRemaining, needs2.spendingRemaining);
            const catText = compatibility.categories && compatibility.categories.length > 0
                ? compatibility.categories.join(', ') + ' categories'
                : 'any category';
            strategies.push(`Spend $${totalNeeded} in ${catText} to satisfy both offers`);
        } else if (needs1.type === 'spending' && needs2.type === 'transactions') {
            const avgPerTransaction = Math.ceil(needs1.spendingRemaining / needs2.transactionsRemaining);
            strategies.push(`Make ${needs2.transactionsRemaining} transactions averaging $${avgPerTransaction} each`);
        } else if (needs1.type === 'transactions' && needs2.type === 'spending') {
            const avgPerTransaction = Math.ceil(needs2.spendingRemaining / needs1.transactionsRemaining);
            strategies.push(`Make ${needs1.transactionsRemaining} transactions averaging $${avgPerTransaction} each`);
        }

        if (compatibility.minTransaction > 0) {
            strategies.push(`Each transaction must be at least $${compatibility.minTransaction}`);
        }

        return strategies;
    }

    generateSingleOfferStrategy(needs, offer) {
        const strategies = [];

        if (needs.type === 'spending') {
            strategies.push(`Spend remaining $${needs.spendingRemaining}`);
        } else if (needs.type === 'transactions') {
            strategies.push(`Make ${needs.transactionsRemaining} more transactions`);
        }

        if (offer.categories && offer.categories.length > 0) {
            strategies.push(`Must be in ${offer.categories.join(', ')} categories`);
        }

        if (offer.minTransaction) {
            strategies.push(`Minimum $${offer.minTransaction} per transaction`);
        }

        return strategies;
    }

    generateDetailedOptimalStrategy(offers, remainingNeeds, compatibility, startDate, endDate) {
        const strategies = [];

        // Analyze the time period structure
        const periodAnalysis = this.analyzePeriodStructure(offers, startDate, endDate);

        // Calculate optimal transaction pattern
        const optimalPattern = this.calculateOptimalTransactionPattern(offers, remainingNeeds, compatibility, periodAnalysis);

        // Generate specific recommendations
        if (optimalPattern.totalSpending > 0) {
            strategies.push(`💰 Total spending needed: $${optimalPattern.totalSpending.toFixed(2)}`);
        }

        if (optimalPattern.totalTransactions > 0) {
            strategies.push(`🛒 Total transactions needed: ${optimalPattern.totalTransactions}`);
        }

        if (optimalPattern.avgPerTransaction > 0) {
            strategies.push(`📊 Average per transaction: $${optimalPattern.avgPerTransaction.toFixed(2)}`);
        }

        // Add timing-specific recommendations
        if (periodAnalysis.hasMonthlyOffers) {
            strategies.push(`📅 Monthly breakdown:`);

            // Check if any monthly offers have completed months we should mention
            const hasCompletedMonths = offers.some(offer => {
                if (offer.monthlyTracking && offer.progress && offer.progress.months) {
                    return offer.progress.months.some(month => month.completed);
                }
                return false;
            });

            if (hasCompletedMonths) {
                const completedMonthsSet = new Set();
                offers.forEach(offer => {
                    if (offer.monthlyTracking && offer.progress && offer.progress.months) {
                        offer.progress.months.forEach(month => {
                            if (month.completed) {
                                completedMonthsSet.add(month.month);
                            }
                        });
                    }
                });

                if (completedMonthsSet.size > 0) {
                    strategies.push(`   ✅ Already completed: ${Array.from(completedMonthsSet).join(', ')}`);
                }
            }

            periodAnalysis.monthlyBreakdown.forEach(month => {
                if (month.transactionsNeeded > 0 || month.spendingNeeded > 0) {
                    let monthStrategy = `   • ${month.dateRange || month.monthName}: `;
                    if (month.transactionsNeeded > 0 && month.spendingNeeded > 0) {
                        monthStrategy += `${month.transactionsNeeded} transactions totaling $${month.spendingNeeded.toFixed(2)}`;
                    } else if (month.transactionsNeeded > 0) {
                        monthStrategy += `${month.transactionsNeeded} transactions`;
                    } else {
                        monthStrategy += `$${month.spendingNeeded.toFixed(2)} spending`;
                    }

                    if (month.daysRemaining < 7) {
                        monthStrategy += ` ⚡ (${month.daysRemaining} days left!)`;
                    }

                    strategies.push(monthStrategy);
                }
            });
        }

        // Add specific dates for urgent recommendations
        if (periodAnalysis.urgentDeadlines.length > 0) {
            strategies.push(`⏰ Urgent deadlines:`);
            periodAnalysis.urgentDeadlines.forEach(deadline => {
                strategies.push(`   • Complete by ${deadline.date.toLocaleDateString()}: ${deadline.description}`);
            });
        }

        // Add category and minimum transaction requirements
        if (compatibility.categories && compatibility.categories.length > 0) {
            strategies.push(`🏷️ Accepted categories: ${compatibility.categories.join(', ')}`);
        }

        if (compatibility.minTransaction > 0) {
            strategies.push(`💳 Each transaction must be at least $${compatibility.minTransaction}`);
        }

        // Add optimization tips
        strategies.push(`🎯 Optimization tip: ${this.generateOptimizationTip(offers, optimalPattern)}`);

        return strategies;
    }

    analyzePeriodStructure(offers, startDate, endDate) {
        const analysis = {
            hasMonthlyOffers: offers.some(offer => offer.monthlyTracking),
            monthlyBreakdown: [],
            urgentDeadlines: [],
            totalDays: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
        };

        if (analysis.hasMonthlyOffers) {
            // Generate month-by-month breakdown
            let currentDate = new Date(startDate);
            const endDateCopy = new Date(endDate);

            while (currentDate <= endDateCopy) {
                const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

                const effectiveStart = new Date(Math.max(monthStart, startDate));
                const effectiveEnd = new Date(Math.min(monthEnd, endDate));

                if (effectiveStart <= effectiveEnd) {
                    const daysInPeriod = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
                    const daysRemaining = Math.ceil((effectiveEnd - new Date()) / (1000 * 60 * 60 * 24));

                    analysis.monthlyBreakdown.push({
                        monthName: effectiveStart.toLocaleString('default', { month: 'long', year: 'numeric' }),
                        start: effectiveStart,
                        end: effectiveEnd,
                        daysInPeriod,
                        daysRemaining: Math.max(0, daysRemaining),
                        transactionsNeeded: 0,
                        spendingNeeded: 0
                    });
                }

                currentDate.setMonth(currentDate.getMonth() + 1);
            }
        }

        // Find urgent deadlines (within 7 days)
        const today = new Date();
        const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        offers.forEach(offer => {
            if (offer.endDate <= sevenDaysFromNow) {
                analysis.urgentDeadlines.push({
                    date: offer.endDate,
                    description: `${offer.name} expires`,
                    offer: offer
                });
            }
        });

        return analysis;
    }

    calculateOptimalTransactionPattern(offers, remainingNeeds, compatibility, periodAnalysis) {
        let totalSpending = 0;
        let totalTransactions = 0;

        // Use actual monthly breakdown data from remaining needs
        const monthlyData = new Map();

        remainingNeeds.forEach((need, index) => {
            const offer = offers[index];

            if (offer.monthlyTracking && need.monthlyBreakdown.length > 0) {
                // Use actual monthly breakdown from needs calculation
                need.monthlyBreakdown.forEach(monthNeed => {
                    const monthKey = monthNeed.month;
                    const existing = monthlyData.get(monthKey) || {
                        monthName: monthNeed.month,
                        spendingNeeded: 0,
                        transactionsNeeded: 0,
                        daysRemaining: monthNeed.daysRemaining,
                        dateRange: monthNeed.dateRange
                    };

                    // Take the maximum requirement for each month
                    existing.spendingNeeded = Math.max(existing.spendingNeeded, monthNeed.spendingRemaining);
                    existing.transactionsNeeded = Math.max(existing.transactionsNeeded, monthNeed.transactionsRemaining);

                    monthlyData.set(monthKey, existing);
                });

                // Calculate totals from monthly data
                totalSpending = Math.max(totalSpending, need.spendingRemaining);
                totalTransactions = Math.max(totalTransactions, need.transactionsRemaining);
            } else {
                // Handle non-monthly offers
                totalSpending = Math.max(totalSpending, need.spendingRemaining || 0);
                totalTransactions = Math.max(totalTransactions, need.transactionsRemaining || 0);
            }
        });

        // Update period analysis with actual monthly data
        periodAnalysis.monthlyBreakdown = Array.from(monthlyData.values());

        // Calculate average per transaction
        let avgPerTransaction = 0;
        if (totalTransactions > 0 && totalSpending > 0) {
            avgPerTransaction = totalSpending / totalTransactions;
        } else if (totalSpending > 0 && compatibility.minTransaction > 0) {
            avgPerTransaction = Math.max(compatibility.minTransaction, totalSpending / Math.max(1, totalTransactions));
            totalTransactions = Math.max(totalTransactions, Math.ceil(totalSpending / compatibility.minTransaction));
        }

        return {
            totalSpending,
            totalTransactions,
            avgPerTransaction
        };
    }

    generateOptimizationTip(offers, pattern) {
        const tips = [];

        if (pattern.totalTransactions > 0 && pattern.avgPerTransaction > 0) {
            if (pattern.avgPerTransaction > 100) {
                tips.push("Consider larger purchases like electronics or appliances to hit higher transaction minimums efficiently");
            } else if (pattern.avgPerTransaction > 50) {
                tips.push("Perfect for grocery shopping or dining out to meet transaction requirements");
            } else {
                tips.push("Small purchases like coffee or lunch can help meet transaction count goals");
            }
        }

        const hasOnlineCategory = offers.some(offer => offer.categories && offer.categories.includes('online'));
        const hasGroceryCategory = offers.some(offer => offer.categories && offer.categories.includes('grocery'));

        if (hasOnlineCategory) {
            tips.push("Online purchases often have easy returns if needed");
        }

        if (hasGroceryCategory) {
            tips.push("Stock up on non-perishables to maximize grocery spending");
        }

        return tips[0] || "Focus spending on necessary purchases to avoid overspending";
    }

    calculateMultiOfferSavings(remainingNeeds, offers) {
        // Calculate how much money/transactions could be saved by combining
        let dollarsSaved = 0;
        let transactionsSaved = 0;

        // Calculate total if done separately
        const totalSpendingSeparate = remainingNeeds.reduce((sum, need) => sum + (need.spendingRemaining || 0), 0);
        const totalTransactionsSeparate = remainingNeeds.reduce((sum, need) => sum + (need.transactionsRemaining || 0), 0);

        // Calculate total if done together (max of all requirements)
        const totalSpendingTogether = Math.max(...remainingNeeds.map(need => need.spendingRemaining || 0));
        const totalTransactionsTogether = Math.max(...remainingNeeds.map(need => need.transactionsRemaining || 0));

        dollarsSaved = Math.max(0, totalSpendingSeparate - totalSpendingTogether);
        transactionsSaved = Math.max(0, totalTransactionsSeparate - totalTransactionsTogether);

        const description = offers.length > 2
            ? `Combining ${offers.length} offers could save $${dollarsSaved.toFixed(2)} and ${transactionsSaved} transactions`
            : `Save up to $${dollarsSaved.toFixed(2)} by combining these offers`;

        return dollarsSaved > 0 || transactionsSaved > 0 ? {
            dollarsSaved,
            transactionsSaved,
            description
        } : null;
    }

    formatDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        // If same month, show "October 1-14, 2025"
        if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            const monthName = start.toLocaleString('default', { month: 'long' });
            const year = start.getFullYear();

            if (start.getDate() === 1 && end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()) {
                // Full month
                return `${monthName} ${year}`;
            } else {
                // Partial month
                return `${monthName} ${start.getDate()}-${end.getDate()}, ${year}`;
            }
        } else {
            // Different months, show full range
            return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
        }
    }

    async generateMasterStrategy(activeOffers, overlaps, today) {
        if (activeOffers.length === 0) {
            return null;
        }

        // Find the optimal combination of overlaps to cover all offers
        const optimalCombination = this.findOptimalOfferCombination(activeOffers, overlaps);

        // Calculate needs for all offers
        const allNeeds = await Promise.all(
            activeOffers.map(offer => this.calculateRemainingNeedsWithProgress(offer, offer.progress, today, offer.endDate))
        );

        // Create comprehensive strategy
        const masterStrategy = {
            title: activeOffers.length === 1
                ? `Complete: ${activeOffers[0].name}`
                : `Most Optimal Strategy: Complete All ${activeOffers.length} Active Offers`,
            priority: 'master',
            offersCount: activeOffers.length,
            optimalCombination: optimalCombination,
            strategy: await this.generateOptimalComprehensiveStrategy(activeOffers, allNeeds, optimalCombination, today),
            offers: activeOffers.map(o => o.name),
            totalPotentialReward: activeOffers.reduce((sum, offer) => {
                let reward = offer.reward || 0;
                if (offer.bonusReward) reward += offer.bonusReward;
                if (offer.monthlyTracking && offer.progress && offer.progress.months) {
                    // For monthly offers, multiply by number of incomplete months
                    const incompleteMonths = offer.progress.months.filter(m => !m.completed).length;
                    reward = (offer.reward || 0) * incompleteMonths + (offer.bonusReward || 0);
                }
                return sum + reward;
            }, 0)
        };

        return masterStrategy;
    }

    findOptimalOfferCombination(activeOffers, overlaps) {
        // Handle edge cases
        if (!activeOffers || activeOffers.length === 0) {
            return {
                selectedOverlaps: [],
                uncoveredOffers: [],
                totalCoverage: 0,
                efficiency: 0
            };
        }

        if (!overlaps || overlaps.length === 0) {
            return {
                selectedOverlaps: [],
                uncoveredOffers: activeOffers,
                totalCoverage: 0,
                efficiency: activeOffers.length
            };
        }

        // Create a coverage map to track which offers are covered by each overlap
        const coverageMap = new Map();

        // Initialize with individual offers (no overlap)
        activeOffers.forEach(offer => {
            if (offer && offer.id && !coverageMap.has(offer.id)) {
                coverageMap.set(offer.id, {
                    type: 'individual',
                    offers: [offer],
                    overlap: null,
                    efficiency: 1 // individual completion = baseline efficiency
                });
            }
        });

        // Analyze overlaps and their efficiency
        const overlapAnalysis = overlaps.filter(overlap => overlap && overlap.offers && overlap.offers.length > 0).map(overlap => {
            const efficiency = overlap.offers.length; // More offers = higher efficiency
            const timeWindow = (new Date(overlap.endDate) - new Date(overlap.startDate)) / (1000 * 60 * 60 * 24);

            return {
                ...overlap,
                efficiency,
                timeWindow,
                score: efficiency * (365 / Math.max(timeWindow, 1)) // Efficiency weighted by time pressure
            };
        });

        // Sort overlaps by score (efficiency and urgency)
        overlapAnalysis.sort((a, b) => b.score - a.score);

        // Find the optimal combination using greedy approach
        const selectedOverlaps = [];
        const coveredOfferIds = new Set();

        for (const overlap of overlapAnalysis) {
            // Check if this overlap covers any uncovered offers
            const newOffers = overlap.offers.filter(offer => offer && offer.id && !coveredOfferIds.has(offer.id));

            if (newOffers.length > 0) {
                // This overlap provides value, add it
                selectedOverlaps.push({
                    ...overlap,
                    newOffersCovered: newOffers.length,
                    newOffers: newOffers
                });

                // Mark these offers as covered
                overlap.offers.forEach(offer => {
                    if (offer && offer.id) {
                        coveredOfferIds.add(offer.id);
                    }
                });
            }
        }

        // Identify any remaining uncovered offers
        const uncoveredOffers = activeOffers.filter(offer => offer && offer.id && !coveredOfferIds.has(offer.id));

        return {
            selectedOverlaps,
            uncoveredOffers,
            totalCoverage: coveredOfferIds.size,
            efficiency: selectedOverlaps.reduce((sum, overlap) => sum + overlap.efficiency, 0) + uncoveredOffers.length
        };
    }

    async generateOptimalComprehensiveStrategy(allOffers, allNeeds, optimalCombination, today) {
        try {
            const strategies = [];

            // Handle edge cases
            if (!allOffers || allOffers.length === 0) {
                return ['No active offers found.'];
            }

            if (!optimalCombination) {
                return ['Error: Unable to generate strategy - missing optimization data.'];
            }

            // Start with total potential reward
            const totalReward = allOffers.reduce((sum, offer) => {
                let reward = offer.reward || 0;
                if (offer.bonusReward) reward += offer.bonusReward;
                if (offer.monthlyTracking && offer.progress && offer.progress.months) {
                    const incompleteMonths = offer.progress.months.filter(m => !m.completed).length;
                    reward = (offer.reward || 0) * incompleteMonths + (offer.bonusReward || 0);
                }
                return sum + reward;
            }, 0);

        // Start directly with the action phases (total earnings already shown in gold badge)

        // Process each selected overlap as a phase
        let phaseNumber = 1;
        for (const overlap of optimalCombination.selectedOverlaps) {
            const overlapNeeds = await Promise.all(
                overlap.offers.map(offer => this.calculateRemainingNeedsWithProgress(offer, offer.progress, overlap.startDate, overlap.endDate))
            );

            // Create clear action-oriented formatting
            const periodAnalysis = this.analyzePeriodStructure(overlap.offers, overlap.startDate, overlap.endDate);
            const optimalPattern = this.calculateOptimalTransactionPattern(overlap.offers, overlapNeeds, overlap.compatibility, periodAnalysis);

            // Generate accurate completion descriptions
            const completionDescriptions = await this.generateCompletionDescriptions(overlap.offers, overlap.startDate, overlap.endDate);

            // Build the complete action phase HTML
            let actionPhaseHtml = `
                <div class="action-phase">
                    <h2 class="phase-header">🚀 <strong>ACTION REQUIRED</strong> - Phase ${phaseNumber}</h2>

                    <div class="what-to-do">
                        <h3 class="section-title">📋 <strong>WHAT TO DO:</strong></h3>
                        <div class="action-summary">
                            <div class="main-action">🛒 <strong>MAKE ${optimalPattern.totalTransactions} TRANSACTIONS</strong></div>
                            <div class="action-details">
                                <div class="detail-item">💰 <strong>Amount:</strong> $${optimalPattern.totalSpending.toFixed(2)} total spending</div>
                                <div class="detail-item">🏪 <strong>Where:</strong> ${
                                    overlap.compatibility.categories && overlap.compatibility.categories.length > 0
                                        ? overlap.compatibility.categories.join(', ') + ' purchases'
                                        : 'Any merchant purchases'
                                }</div>
                                <div class="detail-item">💵 <strong>Per Transaction:</strong> Minimum $${overlap.compatibility.minTransaction} each</div>
                            </div>
                        </div>
                    </div>

                    <div class="timing-section">
                        <h3 class="section-title">⏰ <strong>WHEN:</strong></h3>`;

            // Add timing information
            if (periodAnalysis.hasMonthlyOffers && periodAnalysis.monthlyBreakdown.length > 0) {
                periodAnalysis.monthlyBreakdown.forEach(month => {
                    if (month.transactionsNeeded > 0 || month.spendingNeeded > 0) {
                        actionPhaseHtml += `
                            <div class="timing-item">
                                <div class="date-header">📅 <strong>${month.dateRange || month.monthName}:</strong></div>`;

                        let timingDetails = '';
                        if (month.transactionsNeeded > 0 && month.spendingNeeded > 0) {
                            timingDetails = `${month.transactionsNeeded} transactions totaling $${month.spendingNeeded.toFixed(2)}`;
                        } else if (month.transactionsNeeded > 0) {
                            timingDetails = `${month.transactionsNeeded} transactions`;
                        } else {
                            timingDetails = `$${month.spendingNeeded.toFixed(2)} spending`;
                        }

                        actionPhaseHtml += `<div class="timing-details">→ ${timingDetails}</div>`;

                        if (month.daysRemaining < 7) {
                            actionPhaseHtml += `<div class="urgent-warning">⚡ <strong>URGENT:</strong> Only ${month.daysRemaining} days left!</div>`;
                        }
                        actionPhaseHtml += `</div>`;
                    }
                });
            } else {
                // Single period overlap
                const startDate = new Date(overlap.startDate);
                const endDate = new Date(overlap.endDate);
                const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
                actionPhaseHtml += `
                    <div class="timing-item">
                        <div class="date-header">📅 <strong>${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}</strong> (${daysInPeriod} days)</div>
                    </div>`;
            }

            actionPhaseHtml += `
                    </div>

                    <div class="completion-section">
                        <h3 class="section-title">✅ <strong>WHAT THIS COMPLETES:</strong></h3>
                        <div class="completion-list">`;

            completionDescriptions.completed.forEach(completion => {
                actionPhaseHtml += `<div class="completion-item">✓ ${completion}</div>`;
            });

            actionPhaseHtml += `</div></div>`;

            // Add remaining portions that need separate completion
            if (completionDescriptions.remaining.length > 0) {
                actionPhaseHtml += `
                    <div class="remaining-section">
                        <h3 class="section-title warning">⚠️ <strong>STILL NEEDED LATER:</strong></h3>
                        <div class="remaining-list">`;

                completionDescriptions.remaining.forEach(remaining => {
                    actionPhaseHtml += `<div class="remaining-item">• ${remaining}</div>`;
                });

                actionPhaseHtml += `</div></div>`;
            }

            actionPhaseHtml += `</div>`; // Close action-phase

            strategies.push(actionPhaseHtml);
            strategies.push(`<hr class="section-divider">`);

            phaseNumber++;
        }

        // Strategy for individually completed offers
        if (optimalCombination.uncoveredOffers.length > 0) {
            strategies.push(`\n## 📝 **ADDITIONAL OFFERS** - Phase ${phaseNumber}`);
            strategies.push(`*Complete these individually (no overlap opportunities)*`);

            for (const offer of optimalCombination.uncoveredOffers) {
                const needs = await this.calculateRemainingNeedsWithProgress(offer, offer.progress, today, offer.endDate);
                if (needs.needed) {
                    strategies.push(`\n### 🎯 **${offer.name}**`);

                    strategies.push(`\n**📋 WHAT TO DO:**`);
                    if (needs.transactionsRemaining > 0) {
                        strategies.push(`   🛒 **Make ${needs.transactionsRemaining} transactions**`);
                    }
                    if (needs.spendingRemaining > 0) {
                        strategies.push(`   💰 **Spend:** $${needs.spendingRemaining.toFixed(2)} total`);
                    }
                    if (offer.categories && offer.categories.length > 0) {
                        strategies.push(`   🏪 **Where:** ${offer.categories.join(', ')} purchases`);
                    }
                    if (offer.minTransaction) {
                        strategies.push(`   💵 **Per Transaction:** Minimum $${offer.minTransaction}`);
                    }

                    // Enhanced monthly breakdown for individual offers
                    if (needs.monthlyBreakdown && needs.monthlyBreakdown.length > 0) {
                        strategies.push(`\n**⏰ WHEN:**`);
                        needs.monthlyBreakdown.forEach(month => {
                            strategies.push(`   📅 **${month.dateRange}:**`);
                            if (month.transactionsRemaining > 0 && month.spendingRemaining > 0) {
                                strategies.push(`      → ${month.transactionsRemaining} transactions totaling $${month.spendingRemaining.toFixed(2)}`);
                            } else if (month.transactionsRemaining > 0) {
                                strategies.push(`      → ${month.transactionsRemaining} transactions`);
                            } else {
                                strategies.push(`      → $${month.spendingRemaining.toFixed(2)} spending`);
                            }
                            if (month.daysRemaining < 7) {
                                strategies.push(`      ⚡ **URGENT:** Only ${month.daysRemaining} days left!`);
                            }
                        });
                    }

                    const offerDeadline = new Date(offer.endDate + 'T23:59:59');
                    const daysUntilDeadline = Math.ceil((offerDeadline - today) / (1000 * 60 * 60 * 24));
                    strategies.push(`\n**⏳ DEADLINE:** ${offerDeadline.toLocaleDateString()} (${daysUntilDeadline} days remaining)`);
                    strategies.push(`\n---`);
                }
            }
        }

        // Enhanced optimization tips - build as complete HTML block
        let optimizationSummaryHtml = `
            <div class="optimization-summary">
                <h2 class="summary-header">💡 <strong>OPTIMIZATION SUMMARY</strong></h2>`;

        if (optimalCombination.selectedOverlaps.length > 0) {
            const primaryOverlap = optimalCombination.selectedOverlaps[0];
            optimizationSummaryHtml += `
                <div class="priority-tip">
                    <strong>🎯 PRIORITY:</strong> Focus on Phase 1 first - each transaction completes ${primaryOverlap.offers.length} offers simultaneously!
                </div>`;

            if (optimalCombination.selectedOverlaps.length > 1) {
                optimizationSummaryHtml += `
                    <div class="sequence-tip">
                        <strong>📋 SEQUENCE:</strong> Complete overlap phases in order, then handle individual offers.
                    </div>`;
            }

            if (optimalCombination.uncoveredOffers.length > 0) {
                optimizationSummaryHtml += `
                    <div class="timing-tip">
                        <strong>⏰ TIMING:</strong> Handle individual offers based on deadlines and your spending capacity.
                    </div>`;
            }
        } else {
            optimizationSummaryHtml += `
                <div class="approach-tip">
                    <strong>📋 APPROACH:</strong> No overlaps found - complete offers individually by deadline priority.
                </div>`;
        }

        optimizationSummaryHtml += `</div>`; // Close optimization-summary

        strategies.push(optimizationSummaryHtml);

            return strategies;
        } catch (error) {
            console.error('Error generating optimal comprehensive strategy:', error);
            return [`Error generating strategy: ${error.message}`];
        }
    }

    async generateCompletionDescriptions(offers, overlapStartDate, overlapEndDate) {
        const completed = [];
        const remaining = [];

        const overlapStart = new Date(overlapStartDate);
        const overlapEnd = new Date(overlapEndDate);

        for (const offer of offers) {
            if (!offer.monthlyTracking) {
                // Non-monthly offers are completed entirely if they're part of the overlap
                completed.push(offer.name);
            } else {
                // For monthly offers, determine which months are covered by this overlap
                const completedMonths = [];
                const remainingMonths = [];

                if (offer.progress && offer.progress.months) {
                    for (const month of offer.progress.months) {
                        // Extract month name from the actual data structure
                        let monthName;

                        if (month.month) {
                            // The data shows months have a "month" field like "October 2025"
                            // Extract just the month name (remove year for cleaner display)
                            monthName = month.month.replace(' 2025', '');
                        } else {
                            monthName = 'Unknown Month';
                        }

                        // Check if this month overlaps with the overlap period
                        let monthOverlapsWithPeriod = false;

                        if (month.month) {
                            // Parse the month string to create date objects for comparison
                            const monthDate = new Date(month.month + ' 1'); // Add day to make it parseable
                            if (!isNaN(monthDate.getTime())) {
                                // Create start and end of this month
                                const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                                const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

                                monthOverlapsWithPeriod = monthStart <= overlapEnd && monthEnd >= overlapStart;
                            }
                        }

                        if (monthOverlapsWithPeriod && !month.completed) {
                            completedMonths.push(monthName);
                        } else if (!month.completed) {
                            remainingMonths.push(monthName);
                        }
                    }
                }

                // Build completion descriptions
                if (completedMonths.length > 0) {
                    if (completedMonths.length === 1) {
                        completed.push(`${offer.name} (${completedMonths[0]})`);
                    } else {
                        completed.push(`${offer.name} (${completedMonths.join(', ')})`);
                    }
                }

                if (remainingMonths.length > 0) {
                    if (remainingMonths.length === 1) {
                        remaining.push(`${offer.name} (${remainingMonths[0]})`);
                    } else {
                        remaining.push(`${offer.name} (${remainingMonths.join(', ')})`);
                    }
                }
            }
        }

        return { completed, remaining };
    }

    // Utility method to get personal configuration
    getPersonalConfig() {
        return {
            userName: "User",
            cardName: "Credit Card"
        };
    }
}