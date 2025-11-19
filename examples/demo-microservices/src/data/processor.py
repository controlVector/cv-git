"""
Data Processing Service - Python
Handles data transformation, analysis, and storage
"""

from typing import List, Dict, Any, Optional
import json
import asyncio


class DataProcessor:
    """Main data processing class with various transformation methods"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.cache: Dict[str, Any] = {}

    async def process_batch(self, data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Process a batch of data records
        Applies transformations and validations
        """
        results = []
        errors = []

        for record in data:
            try:
                transformed = await self.transform_record(record)
                validated = self.validate_record(transformed)
                if validated:
                    results.append(transformed)
                else:
                    errors.append({'record': record, 'error': 'validation_failed'})
            except Exception as e:
                errors.append({'record': record, 'error': str(e)})

        return {
            'success': len(results),
            'failed': len(errors),
            'results': results,
            'errors': errors
        }

    async def transform_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Transform a single data record"""
        transformed = {}

        # Apply transformations
        for key, value in record.items():
            if isinstance(value, str):
                transformed[key] = self._clean_string(value)
            elif isinstance(value, (int, float)):
                transformed[key] = self._normalize_number(value)
            else:
                transformed[key] = value

        # Add metadata
        transformed['__processed'] = True
        transformed['__timestamp'] = self._get_timestamp()

        return transformed

    def validate_record(self, record: Dict[str, Any]) -> bool:
        """
        Validate a processed record
        Returns True if valid, False otherwise
        """
        required_fields = self.config.get('required_fields', [])

        for field in required_fields:
            if field not in record:
                return False

        return True

    def _clean_string(self, value: str) -> str:
        """Clean and normalize string values"""
        return value.strip().lower()

    def _normalize_number(self, value: float) -> float:
        """Normalize numeric values"""
        return round(value, 2)

    def _get_timestamp(self) -> int:
        """Get current timestamp"""
        import time
        return int(time.time())

    async def aggregate_data(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Aggregate data records and compute statistics
        High complexity function for demo purposes
        """
        if not records:
            return {'count': 0}

        total = 0
        count = 0
        categories: Dict[str, int] = {}
        values = []

        for record in records:
            if 'value' in record:
                val = record['value']
                if isinstance(val, (int, float)):
                    total += val
                    count += 1
                    values.append(val)

            if 'category' in record:
                cat = record['category']
                if cat in categories:
                    categories[cat] += 1
                else:
                    categories[cat] = 1

        average = total / count if count > 0 else 0
        maximum = max(values) if values else 0
        minimum = min(values) if values else 0

        return {
            'count': count,
            'total': total,
            'average': average,
            'max': maximum,
            'min': minimum,
            'categories': categories
        }


class DataStore:
    """Handle data persistence and retrieval"""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self._connected = False

    async def connect(self) -> bool:
        """Establish database connection"""
        # Simulated connection
        await asyncio.sleep(0.1)
        self._connected = True
        return True

    async def save(self, data: Dict[str, Any]) -> str:
        """Save data and return ID"""
        if not self._connected:
            raise ConnectionError("Not connected to database")

        # Simulated save
        data_id = self._generate_id()
        return data_id

    async def fetch(self, data_id: str) -> Optional[Dict[str, Any]]:
        """Fetch data by ID"""
        if not self._connected:
            raise ConnectionError("Not connected to database")

        # Simulated fetch
        return None

    def _generate_id(self) -> str:
        """Generate unique ID"""
        import uuid
        return str(uuid.uuid4())


def process_csv_data(file_path: str) -> List[Dict[str, Any]]:
    """
    Process CSV file and return parsed records
    This is a standalone function that could be dead code
    if never called from the service
    """
    records = []
    try:
        import csv
        with open(file_path, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                records.append(dict(row))
    except Exception as e:
        print(f"Error processing CSV: {e}")

    return records


async def main():
    """Main entry point for the data service"""
    config = {
        'required_fields': ['id', 'value'],
        'batch_size': 100
    }

    processor = DataProcessor(config)
    store = DataStore('postgresql://localhost/data')

    await store.connect()

    # Process sample data
    sample_data = [
        {'id': 1, 'value': 42, 'category': 'A'},
        {'id': 2, 'value': 38, 'category': 'B'},
    ]

    result = await processor.process_batch(sample_data)
    print(f"Processed {result['success']} records")


if __name__ == '__main__':
    asyncio.run(main())
