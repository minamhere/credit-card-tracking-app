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

    // Helper to parse date string as local calendar date at noon (avoids timezone edge cases)
    parseLocalDate(dateString) {
        // Extract date part if timestamp is included (YYYY-MM-DDT13:00:00 -> YYYY-MM-DD)
        const datePart = dateString.includes('T') ? dateString.split('T')[0] : dateString;

        // Parse YYYY-MM-DD as local date at noon to avoid DST/timezone issues
        const [year, month, day] = datePart.split('-').map(Number);
        return new Date(year, month - 1, day, 12, 0, 0);
    }

    // Helper to check if a date falls within a calendar month (ignoring time)
    isDateInMonth(dateString, monthStart, monthEnd) {
        const date = this.parseLocalDate(dateString);
        // Compare just the calendar dates, not timestamps
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const startOnly = new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate());
        const endOnly = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate());
        return dateOnly >= startOnly && dateOnly <= endOnly;
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
            // Check if transaction falls within offer date range using calendar dates
            const transactionDate = this.parseLocalDate(t.date);
            const offerStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const offerEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const transDate = new Date(transactionDate.getFullYear(), transactionDate.getMonth(), transactionDate.getDate());
            const isInDateRange = transDate >= offerStart && transDate <= offerEnd;

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
                const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1, 0, 0, 0);
                const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);

                const monthTransactions = eligibleTransactions.filter(t => {
                    // Check if transaction date falls within this calendar month
                    return this.isDateInMonth(t.date, monthStart, monthEnd);
                });

                const monthSpending = monthTransactions.reduce((sum, t) => sum + t.amount, 0);
                const monthTransactionCount = monthTransactions.length;

                let monthCompleted = false;
                let monthPartiallyCompleted = false;
                let tierReached = null;
                let earnedReward = 0;

                // Check if offer uses tiers
                if (offer.tiers && offer.tiers.length > 0) {
                    tierReached = this.getTierReached(offer, monthSpending, monthTransactionCount);
                    if (tierReached) {
                        // Check if this is the highest tier
                        const highestTier = [...offer.tiers].sort((a, b) => b.threshold - a.threshold)[0];
                        const isHighestTier = tierReached.threshold === highestTier.threshold;

                        if (isHighestTier) {
                            monthCompleted = true;
                        } else {
                            monthPartiallyCompleted = true;
                        }
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
                    partiallyCompleted: monthPartiallyCompleted,
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
            let partiallyCompleted = false;
            let progress = 0;
            let tierReached = null;
            let earnedReward = 0;

            // Check if offer uses tiers
            if (offer.tiers && offer.tiers.length > 0) {
                tierReached = this.getTierReached(offer, totalSpending, totalTransactions);
                if (tierReached) {
                    // Check if this is the highest tier
                    const highestTier = [...offer.tiers].sort((a, b) => b.threshold - a.threshold)[0];
                    const isHighestTier = tierReached.threshold === highestTier.threshold;

                    if (isHighestTier) {
                        completed = true;
                    } else {
                        partiallyCompleted = true;
                    }
                    earnedReward = tierReached.reward;
                    // Calculate progress to highest tier
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
                partiallyCompleted,
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

    // Get all offers with progress and transactions, sorted by priority
    async getSimplifiedOfferList() {
        try {
            await this.ensureInitialized();
            const offers = await this.getOffers();
            const transactions = await this.getTransactions();
            const today = new Date();

            // Calculate progress for all offers
            const offersWithProgress = [];
            for (const offer of offers) {
                const progress = await this.calculateOfferProgress(offer);
                const startDate = new Date(offer.startDate + 'T00:00:00');
                const endDate = new Date(offer.endDate + 'T23:59:59');

                // Get transactions that apply to this offer
                const offerTransactions = transactions.filter(t => {
                    const transactionDate = this.parseLocalDate(t.date);
                    const offerStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                    const offerEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
                    const transDate = new Date(transactionDate.getFullYear(), transactionDate.getMonth(), transactionDate.getDate());
                    const isInDateRange = transDate >= offerStart && transDate <= offerEnd;

                    const isCategoryMatch = !offer.categories || offer.categories.length === 0 ||
                        (t.categories && t.categories.some(transactionCat =>
                            offer.categories.includes(transactionCat)));

                    const isMinAmountMet = !offer.minTransaction || t.amount >= offer.minTransaction;

                    return isInDateRange && isCategoryMatch && isMinAmountMet;
                });

                // Determine completion status
                let isComplete = false;
                let currentMonthComplete = false;
                let hasActionableMonths = true; // For monthly offers, check if any months can still be worked on

                if (offer.monthlyTracking && progress.months) {
                    isComplete = progress.months.every(month => month.completed);

                    // Check if current month is complete
                    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                    const currentMonthData = progress.months.find(m => {
                        if (!m.month) return false;

                        // Parse month string more reliably
                        const monthParts = m.month.split(' ');
                        const monthName = monthParts[0];
                        const year = monthParts[1] ? parseInt(monthParts[1]) : today.getFullYear();
                        const monthDate = new Date(`${monthName} 1, ${year}`);

                        return monthDate.getFullYear() === currentMonth.getFullYear() &&
                               monthDate.getMonth() === currentMonth.getMonth();
                    });
                    currentMonthComplete = currentMonthData && currentMonthData.completed;

                    // Check if there are any actionable months (not completed and not expired)
                    hasActionableMonths = progress.months.some(month => {
                        if (month.completed) return false; // Already completed

                        // Check if month has expired
                        const monthParts = month.month.split(' ');
                        const monthName = monthParts[0];
                        const year = monthParts[1] ? parseInt(monthParts[1]) : today.getFullYear();
                        const monthDate = new Date(`${monthName} 1, ${year}`);
                        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

                        return monthEnd >= today; // Month is current or future
                    });
                } else {
                    isComplete = progress.completed === true;
                }

                // Calculate days until expiration
                const daysUntilExpiration = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                const expired = today > endDate;
                const notStarted = today < startDate;

                offersWithProgress.push({
                    ...offer,
                    progress,
                    transactions: offerTransactions,
                    isComplete,
                    currentMonthComplete,
                    hasActionableMonths,
                    expired,
                    notStarted,
                    daysUntilExpiration,
                    startDate,
                    endDate
                });
            }

            // Sort offers by priority: Active-Urgent, Active-Lower Priority, Expired-Archived, Expired-Missed
            offersWithProgress.sort((a, b) => {
                // Tier 1: Active - Urgent (not complete, not current month complete)
                // Tier 2: Active - Lower Priority (complete OR current month complete)
                // Tier 3: Expired - Archived Success (complete, expired)
                // Tier 4: Expired - Missed (not complete, expired)
                // Tier 5: Upcoming (not started)

                const getTier = (offer) => {
                    // For monthly offers with no actionable months, treat as effectively done
                    if (offer.monthlyTracking && !offer.hasActionableMonths) {
                        return offer.isComplete ? 3 : 4; // Archived success or missed opportunity
                    }

                    // Active offers (not expired, started)
                    if (!offer.expired && !offer.notStarted) {
                        if (!offer.isComplete && !offer.currentMonthComplete) {
                            return 1; // Active - Urgent
                        } else {
                            return 2; // Active - Lower Priority (completed or current month done)
                        }
                    }

                    // Expired offers
                    if (offer.expired) {
                        return offer.isComplete ? 3 : 4; // Archived success or missed
                    }

                    // Upcoming
                    if (offer.notStarted) return 5;

                    return 6; // Unknown state
                };

                const aTier = getTier(a);
                const bTier = getTier(b);

                if (aTier !== bTier) return aTier - bTier;

                // Within same tier, sort by days until expiration (ascending)
                return a.daysUntilExpiration - b.daysUntilExpiration;
            });

            return offersWithProgress;

        } catch (error) {
            console.error('Error getting simplified offer list:', error);
            return [];
        }
    }

    // Optimal spending recommendations
    async getOptimalSpendingRecommendations() {
        try {
            await this.ensureInitialized();
            const offers = await this.getOffers();
            const transactions = await this.getTransactions();
            const today = new Date();

            console.log('[REC] Total offers loaded:', offers.length);
            console.log('[REC] Offers:', offers.map(o => ({name: o.name, categories: o.categories})));

        // Filter for active, incomplete offers
        const activeOffers = [];
        for (const offer of offers) {
            const progress = await this.calculateOfferProgress(offer);
            const startDate = new Date(offer.startDate + 'T00:00:00');
            const endDate = new Date(offer.endDate + 'T23:59:59');

            console.log(`[REC] ${offer.name}: status=${progress.status}, completed=${progress.completed}`);

            // Only include offers that are:
            // 1. Active or upcoming
            // 2. Not completed (or for monthly tracking, have at least one incomplete month)
            let isIncomplete = false;
            if (offer.monthlyTracking && progress.months) {
                // For monthly tracking, check if any month is incomplete
                isIncomplete = progress.months.some(month => !month.completed);
            } else {
                // For non-monthly offers, check the completed flag
                isIncomplete = progress.completed !== true;
            }

            const isEligible = (progress.status === 'active' || progress.status === 'upcoming') && isIncomplete;

            console.log(`[REC] ${offer.name}: isEligible=${isEligible} (isIncomplete=${isIncomplete})`);

            if (isEligible) {
                activeOffers.push({
                    ...offer,
                    progress,
                    startDate,
                    endDate
                });
            }
        }

        console.log('[REC] Active incomplete offers:', activeOffers.length);
        console.log('[REC] Active offers:', activeOffers.map(o => ({name: o.name, categories: o.categories})));

        if (activeOffers.length === 0) {
            return { recommendations: [], overlaps: [], masterStrategy: null };
        }

            // Find overlapping periods and offers
            const overlaps = this.findOfferOverlaps(activeOffers, today);
            console.log('[REC] Found overlaps:', overlaps.length);
            overlaps.forEach((overlap, i) => {
                console.log(`[REC] Overlap ${i+1}:`, {
                    offerCount: overlap.offerCount,
                    offers: overlap.offers.map(o => o.name),
                    categories: overlap.compatibility?.categories,
                    compatible: overlap.compatibility?.isCompatible
                });
            });

            const recommendations = await this.generateSpendingRecommendations(overlaps, activeOffers, today);
            console.log('[REC] Generated recommendations:', recommendations.length);

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
            // No category requirements - all offers accept any category
            compatibility.categories = [];
            compatibility.reasons.push('Any category accepted by all offers');
        } else if (offersWithCategories.length === 1) {
            // Only one offer has categories, others are general
            // General offers accept any category, so use the categories from the specific offer
            compatibility.categories = [...offersWithCategories[0].categories];
            compatibility.reasons.push(`Accepted categories: ${compatibility.categories.join(', ')}`);
        } else {
            // Multiple offers have category requirements - find INTERSECTION
            // General offers (no categories) will work with whatever intersection we find
            let intersection = new Set(offersWithCategories[0].categories);

            for (let i = 1; i < offersWithCategories.length; i++) {
                const offerCategories = new Set(offersWithCategories[i].categories);
                intersection = new Set([...intersection].filter(cat => offerCategories.has(cat)));
            }

            compatibility.categories = Array.from(intersection);

            if (compatibility.categories.length === 0) {
                // No common categories between category-specific offers - they CANNOT overlap
                compatibility.isCompatible = false;
                return null;
            }

            compatibility.reasons.push(`Common categories: ${compatibility.categories.join(', ')}`);
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
            reasons: [],
            isCompatible: true
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
            // Both have category requirements - find INTERSECTION
            // Only categories that appear in BOTH offers will satisfy both
            const set1 = new Set(offer1.categories);
            const set2 = new Set(offer2.categories);
            const intersection = [...set1].filter(cat => set2.has(cat));

            if (intersection.length === 0) {
                // No common categories - offers cannot overlap
                compatibility.isCompatible = false;
                return null;
            }

            compatibility.categories = intersection;
            compatibility.reasons.push(`Common categories: ${intersection.join(', ')}`);
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
                    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0);
                    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

                    // Ensure periodStart and periodEnd are Date objects
                    const periodStartDate = periodStart instanceof Date ? periodStart : new Date(periodStart);
                    const periodEndDate = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);

                    // Check if this month overlaps with our period and is not completed
                    const overlapStart = new Date(Math.max(monthStart.getTime(), periodStartDate.getTime()));
                    const overlapEnd = new Date(Math.min(monthEnd.getTime(), periodEndDate.getTime()));

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
                    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0);
                    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

                    // Ensure periodStart and periodEnd are Date objects
                    const periodStartDate = periodStart instanceof Date ? periodStart : new Date(periodStart);
                    const periodEndDate = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);

                    // Check if this month overlaps with our period and is not completed
                    const overlapStart = new Date(Math.max(monthStart.getTime(), periodStartDate.getTime()));
                    const overlapEnd = new Date(Math.min(monthEnd.getTime(), periodEndDate.getTime()));

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
                const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1, 0, 0, 0);
                const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);

                const effectiveStart = new Date(Math.max(monthStart.getTime(), startDate.getTime()));
                const effectiveEnd = new Date(Math.min(monthEnd.getTime(), endDate.getTime()));

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

            // Collect all phases with metadata for sorting
            const phases = [];

            // Process each selected overlap as a phase
            for (const overlap of optimalCombination.selectedOverlaps) {
                const overlapNeeds = await Promise.all(
                    overlap.offers.map(offer => this.calculateRemainingNeedsWithProgress(offer, offer.progress, overlap.startDate, overlap.endDate))
                );

                const periodAnalysis = this.analyzePeriodStructure(overlap.offers, overlap.startDate, overlap.endDate);
                const optimalPattern = this.calculateOptimalTransactionPattern(overlap.offers, overlapNeeds, overlap.compatibility, periodAnalysis);
                const completionDescriptions = await this.generateCompletionDescriptions(overlap.offers, overlap.startDate, overlap.endDate);

                // Determine phase completion and expiration
                const phaseComplete = overlapNeeds.every(need => !need.needed);
                const startDate = new Date(overlap.startDate);
                const endDate = new Date(overlap.endDate);
                const notStarted = startDate > today;
                const expired = endDate < today;
                const daysUntilExpiration = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                const daysUntilStart = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

                // Check if current month is complete for monthly offers
                const hasCurrentMonthComplete = overlap.offers.some(offer => {
                    if (offer.monthlyTracking && offer.progress && offer.progress.months) {
                        const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                        const currentMonthData = offer.progress.months.find(m => {
                            if (!m.month) return false;
                            const monthDate = new Date(m.month + ' 1');
                            return monthDate.getFullYear() === currentMonth.getFullYear() &&
                                   monthDate.getMonth() === currentMonth.getMonth();
                        });
                        return currentMonthData && currentMonthData.completed;
                    }
                    return false;
                });

                phases.push({
                    overlap,
                    overlapNeeds,
                    periodAnalysis,
                    optimalPattern,
                    completionDescriptions,
                    complete: phaseComplete,
                    notStarted,
                    expired,
                    daysUntilExpiration,
                    daysUntilStart,
                    hasCurrentMonthComplete
                });
            }

            // Sort phases by priority
            phases.sort((a, b) => {
                const getPriority = (phase) => {
                    // If current month complete but future months remain, lower priority
                    if (phase.hasCurrentMonthComplete && !phase.complete) return 3.5;

                    // Priority levels
                    if (!phase.expired && !phase.complete) return 1; // Urgent - incomplete, not expired
                    if (!phase.expired && phase.complete) return 2;  // Complete, not expired
                    if (phase.expired && phase.complete) return 5;   // Complete, expired
                    if (phase.expired && !phase.complete) return 6;  // Incomplete, expired (missed)

                    return 4; // Default
                };

                const aPriority = getPriority(a);
                const bPriority = getPriority(b);

                if (aPriority !== bPriority) {
                    return aPriority - bPriority;
                }

                // Within same priority, sort by expiration (soonest first)
                return a.daysUntilExpiration - b.daysUntilExpiration;
            });

            // Now generate HTML for sorted phases
            let phaseNumber = 1;
            for (const phase of phases) {
                const overlap = phase.overlap;
                const overlapNeeds = phase.overlapNeeds;
                const periodAnalysis = phase.periodAnalysis;
                const optimalPattern = phase.optimalPattern;
                const completionDescriptions = phase.completionDescriptions;

            // Build the complete action phase HTML
            const headerIcon = phase.complete ? '✅' : (phase.expired ? '⏰' : (phase.notStarted ? '📅' : '🚀'));
            const headerText = phase.complete ? 'COMPLETED' : (phase.expired ? 'EXPIRED' : (phase.notStarted ? 'UPCOMING' : 'ACTION REQUIRED'));
            const daysText = phase.expired ? `(Expired ${Math.abs(phase.daysUntilExpiration)} days ago)` :
                             (phase.notStarted ? `(Starts in ${phase.daysUntilStart} days)` :
                             (phase.daysUntilExpiration < 7 ? `(⚡ ${phase.daysUntilExpiration} days left!)` :
                              `(${phase.daysUntilExpiration} days left)`));

            let actionPhaseHtml = `
                <div class="action-phase ${phase.complete ? 'phase-complete' : ''} ${phase.expired ? 'phase-expired' : ''}">
                    <h2 class="phase-header">${headerIcon} <strong>${headerText}</strong> - Phase ${phaseNumber} ${daysText}</h2>

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
        const completedByOffer = [];
        const remaining = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for comparison

        const overlapStart = new Date(overlapStartDate);
        const overlapEnd = new Date(overlapEndDate);

        // Get all transactions for showing what counts toward each offer
        const transactions = await this.getTransactions();

        for (const offer of offers) {
            if (!offer.monthlyTracking) {
                // Non-monthly offers - show transactions that count toward this offer
                const matchingTransactions = await this.getMatchingTransactionsForOffer(offer, transactions, overlapStart, overlapEnd);

                let offerEntry = `<div class="offer-completion"><strong>${offer.name}</strong>`;
                if (matchingTransactions.length > 0) {
                    offerEntry += `<div class="transaction-breakdown">`;
                    matchingTransactions.forEach(t => {
                        offerEntry += `<div>• $${t.amount.toFixed(2)} at ${t.merchant} (${new Date(t.date).toLocaleDateString()})</div>`;
                    });
                    offerEntry += `</div>`;
                } else {
                    offerEntry += `<div class="transaction-breakdown"><em>No transactions yet</em></div>`;
                }
                offerEntry += `</div>`;

                completedByOffer.push(offerEntry);
            } else {
                // For monthly offers, show transactions per month
                const completedMonths = [];
                const remainingMonths = [];

                if (offer.progress && offer.progress.months) {
                    for (const month of offer.progress.months) {
                        let monthName = month.month ? month.month.replace(' 2025', '') : 'Unknown Month';

                        // Check if this month overlaps with the overlap period AND is not in the past
                        let monthOverlapsWithPeriod = false;
                        let monthIsInFuture = false;

                        if (month.month) {
                            const monthDate = new Date(month.month + ' 1');
                            if (!isNaN(monthDate.getTime())) {
                                const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                                const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

                                monthOverlapsWithPeriod = monthStart <= overlapEnd && monthEnd >= overlapStart;
                                monthIsInFuture = monthEnd >= today;
                            }
                        }

                        if (monthOverlapsWithPeriod) {
                            // Get transactions for this month
                            const monthStart = new Date(month.month + ' 1');
                            const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
                            const matchingTransactions = await this.getMatchingTransactionsForOffer(offer, transactions, monthStart, monthEnd);

                            let monthEntry = `${monthName}`;
                            if (month.completed) {
                                monthEntry += ` ✅`;
                            }
                            if (matchingTransactions.length > 0) {
                                monthEntry += `<div class="transaction-breakdown">`;
                                matchingTransactions.forEach(t => {
                                    monthEntry += `<div>• $${t.amount.toFixed(2)} at ${t.merchant} (${new Date(t.date).toLocaleDateString()})</div>`;
                                });
                                monthEntry += `</div>`;
                            } else if (!month.completed) {
                                monthEntry += `<div class="transaction-breakdown"><em>No transactions yet</em></div>`;
                            }

                            completedMonths.push(monthEntry);
                        } else if (!month.completed && monthIsInFuture) {
                            // Only add to remaining if the month is in the future (not past)
                            remainingMonths.push(monthName);
                        }
                    }
                }

                // Build completion descriptions for monthly offers
                if (completedMonths.length > 0) {
                    let offerEntry = `<div class="offer-completion"><strong>${offer.name}</strong>`;
                    completedMonths.forEach(monthHtml => {
                        offerEntry += `<div class="month-entry">${monthHtml}</div>`;
                    });
                    offerEntry += `</div>`;
                    completedByOffer.push(offerEntry);
                }

                if (remainingMonths.length > 0) {
                    remaining.push(`${offer.name} (${remainingMonths.join(', ')})`);
                }
            }
        }

        return { completed: completedByOffer, remaining };
    }

    // Helper method to get matching transactions for an offer within a date range
    async getMatchingTransactionsForOffer(offer, allTransactions, startDate, endDate) {
        const matchingTransactions = [];

        for (const transaction of allTransactions) {
            const transactionDate = new Date(transaction.date + 'T00:00:00');

            // Check if transaction is within date range
            if (transactionDate < startDate || transactionDate > endDate) {
                continue;
            }

            // Check if transaction meets minimum transaction requirement
            if (offer.minTransaction && transaction.amount < offer.minTransaction) {
                continue;
            }

            // Check if transaction matches category requirements
            if (offer.categories && offer.categories.length > 0) {
                const transactionCategories = transaction.categories || [];
                const hasMatchingCategory = offer.categories.some(cat =>
                    transactionCategories.includes(cat)
                );
                if (!hasMatchingCategory) {
                    continue;
                }
            }

            matchingTransactions.push(transaction);
        }

        return matchingTransactions;
    }

    // Utility method to get personal configuration
    getPersonalConfig() {
        return {
            userName: "User",
            cardName: "Credit Card"
        };
    }
}