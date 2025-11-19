// Legacy Integration Service - Java
// Handles integration with legacy systems and data formats

package com.example.legacy;

import java.util.*;
import java.io.*;
import java.sql.*;

/**
 * Main integration service for legacy system communication
 */
public class Integration {

    private Connection dbConnection;
    private Map<String, String> configCache;

    public Integration(String dbUrl) throws SQLException {
        this.dbConnection = DriverManager.getConnection(dbUrl);
        this.configCache = new HashMap<>();
    }

    /**
     * Fetch data from legacy database
     * @param query SQL query to execute
     * @return List of result rows
     */
    public List<Map<String, Object>> fetchLegacyData(String query) throws SQLException {
        List<Map<String, Object>> results = new ArrayList<>();

        try (Statement stmt = dbConnection.createStatement();
             ResultSet rs = stmt.executeQuery(query)) {

            ResultSetMetaData metaData = rs.getMetaData();
            int columnCount = metaData.getColumnCount();

            while (rs.next()) {
                Map<String, Object> row = new HashMap<>();
                for (int i = 1; i <= columnCount; i++) {
                    String columnName = metaData.getColumnName(i);
                    Object value = rs.getObject(i);
                    row.put(columnName, value);
                }
                results.add(row);
            }
        }

        return results;
    }

    /**
     * Transform legacy data format to modern format
     * @param legacyData Data in legacy format
     * @return Transformed data
     */
    public Map<String, Object> transformLegacyData(Map<String, Object> legacyData) {
        Map<String, Object> transformed = new HashMap<>();

        for (Map.Entry<String, Object> entry : legacyData.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            // Apply transformations based on type
            if (value instanceof String) {
                transformed.put(key, normalizeString((String) value));
            } else if (value instanceof Number) {
                transformed.put(key, normalizeNumber((Number) value));
            } else if (value instanceof Date) {
                transformed.put(key, formatDate((Date) value));
            } else {
                transformed.put(key, value);
            }
        }

        transformed.put("__transformed", true);
        transformed.put("__timestamp", System.currentTimeMillis());

        return transformed;
    }

    /**
     * Batch process multiple legacy records
     * High complexity function for demo purposes
     */
    public ProcessingResult batchProcess(List<Map<String, Object>> records) {
        int successCount = 0;
        int failureCount = 0;
        List<Map<String, Object>> processedRecords = new ArrayList<>();
        List<String> errors = new ArrayList<>();

        for (Map<String, Object> record : records) {
            try {
                Map<String, Object> transformed = transformLegacyData(record);
                boolean valid = validateRecord(transformed);

                if (valid) {
                    processedRecords.add(transformed);
                    successCount++;
                } else {
                    failureCount++;
                    errors.add("Validation failed for record: " + record);
                }
            } catch (Exception e) {
                failureCount++;
                errors.add("Error processing record: " + e.getMessage());
            }
        }

        return new ProcessingResult(successCount, failureCount, processedRecords, errors);
    }

    /**
     * Validate a processed record
     */
    private boolean validateRecord(Map<String, Object> record) {
        // Check required fields
        String[] requiredFields = {"id", "type", "__transformed"};

        for (String field : requiredFields) {
            if (!record.containsKey(field)) {
                return false;
            }
        }

        return true;
    }

    // Helper methods

    private String normalizeString(String value) {
        return value.trim().toUpperCase();
    }

    private Double normalizeNumber(Number value) {
        return Math.round(value.doubleValue() * 100.0) / 100.0;
    }

    private String formatDate(Date date) {
        return date.toString();
    }

    /**
     * Get configuration value from cache
     */
    public String getConfig(String key) {
        return configCache.get(key);
    }

    /**
     * Set configuration value
     */
    public void setConfig(String key, String value) {
        configCache.put(key, value);
    }

    /**
     * Close database connection
     */
    public void close() throws SQLException {
        if (dbConnection != null && !dbConnection.isClosed()) {
            dbConnection.close();
        }
    }
}

/**
 * Result of batch processing operation
 */
class ProcessingResult {
    private int successCount;
    private int failureCount;
    private List<Map<String, Object>> processedRecords;
    private List<String> errors;

    public ProcessingResult(int successCount, int failureCount,
                          List<Map<String, Object>> processedRecords,
                          List<String> errors) {
        this.successCount = successCount;
        this.failureCount = failureCount;
        this.processedRecords = processedRecords;
        this.errors = errors;
    }

    public int getSuccessCount() {
        return successCount;
    }

    public int getFailureCount() {
        return failureCount;
    }

    public List<Map<String, Object>> getProcessedRecords() {
        return processedRecords;
    }

    public List<String> getErrors() {
        return errors;
    }

    @Override
    public String toString() {
        return String.format("ProcessingResult{success=%d, failures=%d, errors=%d}",
                           successCount, failureCount, errors.size());
    }
}

/**
 * Legacy data adapter for specific format conversions
 */
class LegacyDataAdapter {

    /**
     * Convert CSV format to structured data
     */
    public static List<Map<String, Object>> parseCSV(String csvData) {
        List<Map<String, Object>> results = new ArrayList<>();
        String[] lines = csvData.split("\n");

        if (lines.length == 0) {
            return results;
        }

        String[] headers = lines[0].split(",");

        for (int i = 1; i < lines.length; i++) {
            String[] values = lines[i].split(",");
            Map<String, Object> row = new HashMap<>();

            for (int j = 0; j < headers.length && j < values.length; j++) {
                row.put(headers[j].trim(), values[j].trim());
            }

            results.add(row);
        }

        return results;
    }

    /**
     * Convert XML format to structured data
     * This might be dead code if XML is not used
     */
    public static Map<String, Object> parseXML(String xmlData) {
        // Simplified XML parsing
        Map<String, Object> result = new HashMap<>();
        result.put("raw_xml", xmlData);
        return result;
    }
}

/**
 * Main entry point for testing
 */
class Main {
    public static void main(String[] args) {
        try {
            Integration integration = new Integration("jdbc:h2:mem:testdb");

            // Set configuration
            integration.setConfig("batch_size", "100");
            integration.setConfig("retry_count", "3");

            // Create sample data
            List<Map<String, Object>> sampleData = new ArrayList<>();
            Map<String, Object> record1 = new HashMap<>();
            record1.put("id", "1");
            record1.put("type", "user");
            record1.put("value", 42);
            sampleData.add(record1);

            // Process batch
            ProcessingResult result = integration.batchProcess(sampleData);
            System.out.println("Processing complete: " + result);

            integration.close();
        } catch (SQLException e) {
            System.err.println("Database error: " + e.getMessage());
        }
    }
}
