// Policy answers summarize FastBoost_Terms_and_Conditions.pdf, v1.0, 22 Sep 2026.
// LoL and TFT net-win counting reflects the owner's confirmed service rules.
// Section numbers are editorial references; product help follows the current app.
export const refundStages = [
    { id: 'not-started', label: 'Not started', title: 'Full refund', answer: 'You receive the amount paid back, plus restoration of applied rewards or credits. Work starts when gameplay or your booked session begins, not when a booster is assigned, a chat opens or account setup begins.', section: 7 },
    { id: 'in-progress', label: 'In progress', title: 'Refund for undelivered work', answer: 'Only properly delivered work may be charged. The refund uses your original discounted price and the agreed unit or rank-segment values, not a higher current price. If no reliable allocation was disclosed, we agree a fair one with you.', section: 8 },
    { id: 'delivered', label: 'Delivered', title: 'Problems can still be reviewed', answer: 'Fully and correctly delivered work has no change-of-mind refund. Incorrect or missing work, misleading descriptions, unauthorized payments and other legal grounds can still qualify for a remedy. A Completed status alone does not settle a delivery dispute.', section: 8 },
];

export const faqQuestions = [
    {
        id: 'win-loss', topic: 'Orders', popular: true,
        question: 'What happens if my booster loses a Win Boost match?',
        answer: 'For LoL Win Boost, you buy net wins: wins minus losses. A loss must be made up before the booster can finish your purchased target.',
        details: [
            'Each win adds 1 to progress; each loss subtracts 1. One win and one loss leave 0 net wins. Another win brings the total to 1 net win.',
            'For a 5-win order, 7 wins and 2 losses deliver 5 net wins. Five wins and 2 losses deliver only 3, so the order is not finished yet.',
            'The booster continues until the purchased net-win target is reached. You do not need to buy another package to make up those losses.',
        ],
        note: 'TFT uses top-four net wins: 1st–4th adds 1 and 5th–8th subtracts 1. If the match record or completion status looks wrong, send support your order number and the matches in question.',
        to: '/contact', action: 'Get help with win progress', section: 3,
    },
    {
        id: 'track', topic: 'Orders', popular: true, question: 'Where is my order?',
        answer: 'Open My Orders and select the purchase you want to check. Use Open Chat on an ongoing order to see the conversation and ask your booster about progress.',
        details: [
            'Check that you are signed in to the FastBoost account used for the purchase.',
            'If you paid but cannot find the order, contact support with your order number or payment reference. Do not pay again while the payment is being checked.',
        ],
        to: '/account/orders', action: 'View my orders',
    },
    {
        id: 'chat', topic: 'Orders', question: 'How do I contact my booster?',
        answer: 'Go to My Orders and choose Open Chat on your ongoing order. Use that conversation to agree on availability, discuss progress and record instructions.',
        note: 'Keep changes to the service, schedule or price in the order conversation or support email. If you cannot reach your booster or need help resolving an issue, contact support with your order number.',
        to: '/account/orders', action: 'Open my orders', section: 9,
    },
    {
        id: 'results', topic: 'Orders', question: 'What does each boosting service include?',
        answer: 'The completion target depends on the service you purchase. Review your game, region, queue, starting rank, target and extras before paying.',
        details: [
            'Rank Boost: the agreed rank, division and any specified LP requirement must be reached when the completed service is handed over.',
            'LoL Win Boost: the purchased number of net wins must be reached after subtracting losses.',
            'TFT Win Boost: top-four finishes add 1 and bottom-four finishes subtract 1 until the purchased net-win target is reached.',
            'Placement Boost: the purchased number of placement matches must be recorded as completed by the game.',
            'Pro Duo: the purchased games or session time must be played with you. A particular rank or win result is included only if expressly promised.',
        ],
        section: 3,
    },
    {
        id: 'tft-wins', topic: 'Orders', question: 'What counts as a win in TFT Win Boost?',
        answer: 'TFT Win Boost uses top-four net wins. You do not need to finish first for a match to count as a win.',
        details: [
            'Finishing 1st, 2nd, 3rd or 4th adds 1 win to your progress.',
            'Finishing 5th, 6th, 7th or 8th subtracts 1 win. The booster makes up that loss at no extra charge.',
            'For a 3-win order, 4 top-four finishes and 1 bottom-four finish deliver 3 net wins. The order continues until the purchased net-win target is reached.',
        ],
        note: 'A top-four finish counts as one win regardless of the LP gained or lost. A specific rank is a separate target and is included only if your order expressly promises it.',
        to: '/contact', action: 'Get help with TFT progress', section: 3,
    },
    {
        id: 'placements', topic: 'Orders', question: 'Do placement matches guarantee wins or a final rank?',
        answer: 'Placement Boost covers the number of placement matches you buy. A loss still counts as a played placement match if the game records it as completed.',
        note: 'A specific number of wins or final rank is included only if your order expressly promises it. Placement matches do not use the Win Boost net-win rule.',
        section: 3,
    },
    {
        id: 'duo-loss', topic: 'Orders', question: 'What if we lose a Pro Duo game?',
        answer: 'Pro Duo covers the purchased games or session time played with you. A completed game still counts if you lose, unless your order expressly includes a different outcome guarantee.',
        note: 'Pro Duo and Win Boost have different completion rules. Check which service you selected, and agree on your availability in the order chat before the session.',
        to: '/account/orders', action: 'Check my order', section: 3,
    },
    {
        id: 'start-time', topic: 'Orders', question: 'When does my boost start, and how long does it take?',
        answer: 'Check the timing agreed in your order conversation. Ask your booster or support to confirm the planned start, booked session and any agreed completion deadline. Timing depends on the service, queue, game availability and your agreed schedule.',
        note: 'Other completion times are estimates. For cancellation purposes, work starts when gameplay or your booked session actually begins; assigning a booster, opening chat or logging in for setup does not by itself start the service.',
        to: '/account/orders', action: 'Ask about my schedule', section: 7,
    },
    {
        id: 'delay', topic: 'Orders', popular: true, question: 'What if my order is delayed?',
        answer: 'Check the order chat for an update. If there is a material delay, we will explain it and propose a revised schedule.',
        note: 'You can decline a material extension and cancel the undelivered work. An expressly agreed deadline still applies; an estimate does not turn into an unlimited wait. Contact support with your order number if you need help.',
        to: '/contact', action: 'Ask about my order', section: 7,
    },
    {
        id: 'play-during', topic: 'Orders', question: 'Can I play on my account while my boost is in progress?',
        answer: 'Coordinate with your booster in the order chat before playing or changing account details while work is active. Your own games can change the starting rank or progress, and overlapping access can interrupt the service.',
        note: 'If your play or account changes materially affect the agreed work, we will explain any proposed change to the scope, schedule or price and obtain your agreement before charging more.',
        to: '/account/orders', action: 'Coordinate with my booster', section: 5,
    },
    {
        id: 'reschedule', topic: 'Orders', question: 'Can I pause my order or reschedule a duo session?',
        answer: 'Message your booster or support as soon as you know you need a change. Include your order number, the session affected and your new availability with a time zone. Ask for confirmation of the revised schedule.',
        note: 'Availability can affect when work resumes. A missed session is chargeable only if a reasonable cancellation or no-show rule was disclosed and accepted when booking; otherwise, unused work follows the cancellation policy.',
        to: '/contact', action: 'Request a schedule change', section: 7,
    },
    {
        id: 'change-order', topic: 'Orders', question: 'What if I chose the wrong region, queue or rank?',
        answer: 'Contact support promptly with your order number and the correct details, ideally before gameplay begins. Ask us to confirm whether the order can be adjusted before making another purchase.',
        note: 'Changes may affect availability, the work required or the price. Any change to the accepted price needs your agreement. If you choose to cancel, the refund depends on what has been properly delivered.',
        to: '/contact', action: 'Correct my order', section: 6,
    },
    {
        id: 'extras', topic: 'Orders', question: 'Are champion preferences and other extras guaranteed?',
        answer: 'Selected extras apply as described at checkout. Champion preferences, scheduling requests and similar options are guaranteed only when your order expressly says so.',
        note: 'If a paid extra cannot be supplied as agreed, we will offer an acceptable alternative or refund its undelivered value. Raise the issue in your order chat or with support so the agreed solution is recorded.',
        to: '/contact', action: 'Get help with an extra', section: 3,
    },
    {
        id: 'rank-after', topic: 'Orders', question: 'What if my rank drops after a Rank Boost?',
        answer: 'The agreed target rank, division and any specified LP requirement must be reached at handover. A rank reached earlier but lost before handover does not by itself complete the order.',
        note: 'There is no promise that your rank will stay unchanged after a correctly completed handover. If the target was never delivered or the completion record is wrong, contact support with the relevant match details.',
        to: '/contact', action: 'Review my rank progress', section: 3,
    },
    {
        id: 'service-problem', topic: 'Orders', question: 'What if my order is marked complete but work is missing?',
        answer: 'Send support your order number, the target or extra that is missing, and relevant match details or screenshots. A dashboard status alone does not establish that disputed work was properly delivered.',
        details: [
            'We review the underlying match results, timestamps and agreed session records.',
            'An appropriate remedy may include correction, repeat work, a price reduction or a refund.',
            'If we cannot finish the order, you may accept a replacement booster or revised arrangement, or receive a refund for undelivered work.',
        ],
        to: '/contact', action: 'Report a delivery problem', section: 8,
    },
    { id: 'refund', topic: 'Payments', popular: true, question: 'Can I cancel or get a refund?', answer: 'Choose the stage of your order to see the cancellation policy. Refund, cancellation, undelivered work, completed work.', interactive: 'refund', section: 8 },
    {
        id: 'request-refund', topic: 'Payments', question: 'How do I request a cancellation?',
        answer: 'Email support@fastboost.gg with your order number, or enough information to identify the purchase, and say that you want to cancel. No special wording is needed; other valid notice methods are accepted.',
        note: 'Further work stops as soon as reasonably possible. We assess any work already in progress fairly using the agreed delivery rules and records.',
        to: '/contact', action: 'Contact support', section: 8,
    },
    {
        id: 'partial-refund', topic: 'Payments', question: 'How is a partial refund calculated?',
        answer: 'A partial refund covers the undelivered portion at your original agreed price after discounts. We may retain payment only for work properly delivered, subject to any greater legal entitlement.',
        details: [
            'For equally priced games or session minutes, the price is divided by the proportion properly delivered.',
            'For rank segments or differently priced units, the values disclosed before purchase apply. If no reliable allocation was disclosed, we agree a fair one with you.',
            'For example, if 10 equally priced units cost $100 after discounts and 4 are properly delivered, the 6 undelivered units represent $60 of service value. Cash and rewards are returned in their corresponding proportions and types.',
        ],
        note: 'Relevant taxes are adjusted. A disagreement over part of the calculation does not delay an undisputed refund.',
        section: 8,
    },
    { id: 'refund-time', topic: 'Payments', question: 'When will my refund arrive?', answer: 'Refunds due are issued within 14 calendar days of receiving the cancellation or establishing entitlement, as applicable, or sooner if law requires. Your bank or payment provider may take additional time to show the credit.', note: 'If a refund has been issued but is not showing, contact support with your order number so we can help trace it.', to: '/contact', action: 'Check a refund', section: 8 },
    { id: 'refund-method', topic: 'Payments', question: 'What happens to my cash and Gold when I get a refund?', answer: 'Refundable cash returns to the original payment method where possible. Applied Gold or credits are restored in the corresponding proportion and type.', note: 'Free rewards earned on refunded work may be reversed. A cash refund you are entitled to is not replaced with store credit, and we do not deduct a routine administration or payment-processing fee from a refund due under this policy.', section: 8 },
    { id: 'payment', topic: 'Payments', question: 'Payment pending or charged twice?', answer: 'Contact support before paying again. An unfinished checkout is not a confirmed purchase; acceptance requires verified payment and order confirmation.', note: 'Include your order number or payment reference, the payment time and the amount. Never send full card details or security codes. Support can check the payment status and any suspected duplicate charge.', to: '/contact', action: 'Get payment help', section: 6 },
    { id: 'currency', topic: 'Payments', question: 'Which currency am I paying in?', answer: 'All prices and payments are in US dollars (USD). Check your final total, applied discounts and redeemed Gold at checkout before paying. Your bank may add conversion or international transaction fees.', section: 6 },
    { id: 'safety', topic: 'Account', popular: true, question: 'Can my game account be penalized?', answer: 'Yes. Account sharing and prohibited boosting can lead to suspension, lost rewards or access restrictions. Paid duo play is not automatically permitted. FastBoost is independent of Riot Games and cannot promise a penalty-free service.', note: 'Report restrictions promptly so we can review the timing, cause, delivered work and any provider conduct. A restriction does not automatically guarantee reimbursement or automatically remove your right to a remedy.', to: '/contact', action: 'Report an account issue', section: 4 },
    { id: 'credentials', topic: 'Account', question: 'What account details should I share?', answer: 'Only share information needed for your order through the designated channel. Never share email passwords, recovery codes or payment-card details, or disable security controls.', note: 'Order access does not authorize purchases, spending your in-game currency or changing recovery details. Change a shared game password once access is no longer needed.', section: 5 },
    { id: 'eligibility', topic: 'Account', question: 'Who can create an account or order?', answer: 'You must be at least 18 and have reached the age of majority where you live. You must be authorized to use the payment method and be the legitimate holder of the game account. Check your region, queue and rank details before ordering.', section: 2 },
    { id: 'linked', topic: 'Account', popular: true, question: 'Can I sign in with Google or Discord?', answer: 'Yes. If a supported verified email matches your account, choose Link & sign in to connect it. Not now leaves it unlinked. You can also manage linked accounts in Account Settings.', to: '/account/settings', action: 'Account settings' },
    { id: 'password', topic: 'Account', question: 'How do I change my password?', answer: 'Use Change Password if you know your current password. Otherwise, choose Forgot password on the sign-in screen. These options change your FastBoost password; your game account password is managed separately with the game publisher.', to: '/account/change-password', action: 'Change password' },
    { id: 'close', topic: 'Account', question: 'Can I close my account?', answer: 'Email support@fastboost.gg to request closure. Active orders, prepaid work and refunds are still accounted for; necessary payment, dispute and legal records may be retained.', to: '/contact', action: 'Contact support', section: 15 },
    { id: 'gold', topic: 'Rewards', popular: true, question: 'How do I use Gold?', answer: 'Redeem at least 100 Gold per checkout. Every 10 Gold gives $1 off, so 100 Gold gives $10 off, within the order and payment limits.', note: 'Apply Gold at checkout and check the discount and remaining amount before paying. Your loyalty page shows your balance and reward history.', to: '/account/loyalty', action: 'View my Gold' },
    { id: 'referrals', topic: 'Rewards', question: 'How do referral rewards work?', answer: 'Share your dashboard invite link. Your friend gets 10% off their first purchase. Once their first qualifying order of $50 or more before the referral discount is paid and completed, you both receive 50 Gold.', note: 'The reward becomes available for a future purchase after that qualifying order is completed, not just when your friend signs up.', to: '/account/dashboard', action: 'Find my invite link' },
    { id: 'coupons', topic: 'Rewards', question: 'Where are my coupons, and why will a code not apply?', answer: 'Check My Coupons on your dashboard. Copy a code, apply it at checkout and review the discount before paying.', note: 'Check the expiry date and service restrictions if it does not apply. Offers combine only when permitted. If an eligible code still fails, contact support before paying with the code and service you selected.', to: '/account/dashboard', action: 'View my coupons', section: 10 },
    { id: 'cash-out', topic: 'Rewards', question: 'Can I withdraw or transfer Gold?', answer: 'Free promotional Gold is not cash and cannot be withdrawn or transferred unless the offer allows it or law requires. Any value purchased with money follows its own disclosed terms.', section: 10 },
];
