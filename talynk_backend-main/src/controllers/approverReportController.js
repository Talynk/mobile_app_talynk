const prisma = require('../lib/prisma');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

exports.generateReport = async (req, res) => {
    try {
        const { reportType, format, metrics, startDate, endDate } = req.body;
        const approverUsername = req.user.username;

        // Get date range
        const dateRange = getDateRange(reportType, startDate, endDate);

        // Gather report data
        const reportData = await gatherReportData(approverUsername, dateRange, metrics);

        // Generate report in requested format
        switch (format) {
            case 'pdf':
                await generatePDFReport(res, reportData, reportType);
                break;
            case 'csv':
                await generateCSVReport(res, reportData, reportType);
                break;
            case 'excel':
                await generateExcelReport(res, reportData, reportType);
                break;
            default:
                throw new Error('Unsupported format');
        }
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error generating report'
        });
    }
};

// ---------------- GATHER REPORT DATA (Prisma-based) ----------------
async function gatherReportData(approverUsername, dateRange, metrics) {
    // Find approver
    const approver = await prisma.approver.findFirst({
        where: { username: approverUsername }
    });

    if (!approver) {
        throw new Error('Approver not found');
    }

    const data = {
        approver,
        period: {
            start: dateRange.startDate,
            end: dateRange.endDate
        },
        metrics: {}
    };

    // Base query filter
    const baseFilter = {
        approverID: approverUsername,
        updatedAt: {
            gte: new Date(dateRange.startDate),
            lte: new Date(dateRange.endDate)
        }
    };

    // Loop through requested metrics
    for (const metric of metrics) {
        switch (metric) {
            case 'approvals':
                data.metrics.approvals = await prisma.post.count({
                    where: {
                        approver_id: approver.id,
                        status: 'active',
                        updatedAt: {
                            gte: new Date(dateRange.startDate),
                            lte: new Date(dateRange.endDate)
                        }
                    }
                });
                break;

            case 'rejections':
                data.metrics.rejections = await prisma.post.count({
                    where: {
                        approver_id: approver.id,
                        status: 'suspended',
                        updatedAt: {
                            gte: new Date(dateRange.startDate),
                            lte: new Date(dateRange.endDate)
                        }
                    }
                });
                break;

            case 'response_time':
                const posts = await prisma.post.findMany({
                    where: baseFilter,
                    select: {
                        uploadDate: true,
                        approvedDate: true,
                        rejectedDate: true
                    }
                });
                data.metrics.response_time = calculateAverageResponseTime(posts);
                break;
        }
    }

    return data;
}

// ---------------- HELPER FUNCTIONS ----------------

// Dummy function: you should already have this in your utils
function getDateRange(reportType, startDate, endDate) {
    if (reportType === 'custom') {
        return { startDate, endDate };
    }

    const now = new Date();
    let start;
    switch (reportType) {
        case 'weekly':
            start = new Date(now);
            start.setDate(now.getDate() - 7);
            break;
        case 'monthly':
            start = new Date(now);
            start.setMonth(now.getMonth() - 1);
            break;
        default:
            start = new Date(now);
            start.setDate(now.getDate() - 30);
            break;
    }
    return { startDate: start, endDate: now };
}

// Calculate average response time
function calculateAverageResponseTime(posts) {
    let total = 0;
    let count = 0;

    posts.forEach(post => {
        const endDate = post.approvedDate || post.rejectedDate;
        if (post.uploadDate && endDate) {
            const diff = new Date(endDate) - new Date(post.uploadDate);
            total += diff;
            count++;
        }
    });

    return count > 0 ? total / count / (1000 * 60 * 60) : 0; // avg hours
}

// TODO: Implement the PDF/CSV/Excel generation methods
async function generatePDFReport(res, reportData, reportType) { /* ... */ }
async function generateCSVReport(res, reportData, reportType) { /* ... */ }
async function generateExcelReport(res, reportData, reportType) { /* ... */ }
