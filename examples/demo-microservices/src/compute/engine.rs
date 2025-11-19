// Compute Engine - Rust
// High-performance computation service for data-intensive operations

use std::collections::HashMap;
use std::sync::Arc;

/// Configuration for the compute engine
pub struct ComputeConfig {
    max_workers: usize,
    timeout_seconds: u64,
}

/// Result of a computation
#[derive(Debug)]
pub struct ComputeResult {
    pub success: bool,
    pub value: f64,
    pub duration_ms: u128,
}

/// Main compute engine for performing calculations
pub struct ComputeEngine {
    config: ComputeConfig,
    cache: HashMap<String, f64>,
}

impl ComputeEngine {
    /// Create a new compute engine with given configuration
    pub fn new(config: ComputeConfig) -> Self {
        ComputeEngine {
            config,
            cache: HashMap::new(),
        }
    }

    /// Perform a heavy computation
    pub fn compute_heavy_task(&self, data: &[f64]) -> ComputeResult {
        let start = std::time::Instant::now();

        let result = if data.len() == 0 {
            0.0
        } else {
            self.perform_complex_calculation(data)
        };

        ComputeResult {
            success: true,
            value: result,
            duration_ms: start.elapsed().as_millis(),
        }
    }

    /// Perform matrix multiplication
    pub fn multiply_matrices(&self, a: &[Vec<f64>], b: &[Vec<f64>]) -> Option<Vec<Vec<f64>>> {
        if a.is_empty() || b.is_empty() {
            return None;
        }

        let rows_a = a.len();
        let cols_a = a[0].len();
        let cols_b = b[0].len();

        if cols_a != b.len() {
            return None;
        }

        let mut result = vec![vec![0.0; cols_b]; rows_a];

        for i in 0..rows_a {
            for j in 0..cols_b {
                for k in 0..cols_a {
                    result[i][j] += a[i][k] * b[k][j];
                }
            }
        }

        Some(result)
    }

    /// Calculate statistical measures
    pub fn calculate_statistics(&self, data: &[f64]) -> Statistics {
        if data.is_empty() {
            return Statistics::default();
        }

        let sum: f64 = data.iter().sum();
        let mean = sum / data.len() as f64;

        let variance = data
            .iter()
            .map(|x| (x - mean).powi(2))
            .sum::<f64>() / data.len() as f64;

        let std_dev = variance.sqrt();

        let mut sorted = data.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = if sorted.len() % 2 == 0 {
            (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
        } else {
            sorted[sorted.len() / 2]
        };

        Statistics {
            mean,
            median,
            std_dev,
            min: *sorted.first().unwrap(),
            max: *sorted.last().unwrap(),
        }
    }

    /// Perform Fourier transform (simplified)
    /// This is a high-complexity function for demo
    pub fn fourier_transform(&self, data: &[f64]) -> Vec<Complex> {
        let n = data.len();
        let mut result = Vec::with_capacity(n);

        for k in 0..n {
            let mut real = 0.0;
            let mut imag = 0.0;

            for (t, &value) in data.iter().enumerate() {
                let angle = -2.0 * std::f64::consts::PI * (k * t) as f64 / n as f64;
                real += value * angle.cos();
                imag += value * angle.sin();
            }

            result.push(Complex { real, imag });
        }

        result
    }

    // Private helper methods

    fn perform_complex_calculation(&self, data: &[f64]) -> f64 {
        // Simulate complex calculation with multiple steps
        let sum: f64 = data.iter().sum();
        let product: f64 = data.iter().product();
        let squares: f64 = data.iter().map(|x| x * x).sum();

        (sum + product + squares) / data.len() as f64
    }
}

/// Statistical measures
#[derive(Debug, Default)]
pub struct Statistics {
    pub mean: f64,
    pub median: f64,
    pub std_dev: f64,
    pub min: f64,
    pub max: f64,
}

/// Complex number representation
#[derive(Debug, Clone)]
pub struct Complex {
    pub real: f64,
    pub imag: f64,
}

impl Complex {
    pub fn magnitude(&self) -> f64 {
        (self.real * self.real + self.imag * self.imag).sqrt()
    }

    pub fn phase(&self) -> f64 {
        self.imag.atan2(self.real)
    }
}

/// Parallel computation trait
pub trait ParallelCompute {
    fn compute_parallel(&self, data: Vec<f64>) -> Vec<f64>;
}

impl ParallelCompute for ComputeEngine {
    fn compute_parallel(&self, data: Vec<f64>) -> Vec<f64> {
        // Simplified parallel computation
        data.iter().map(|x| x * x).collect()
    }
}

/// Optimization engine for finding optimal solutions
pub struct OptimizationEngine {
    max_iterations: usize,
    tolerance: f64,
}

impl OptimizationEngine {
    pub fn new(max_iterations: usize, tolerance: f64) -> Self {
        OptimizationEngine {
            max_iterations,
            tolerance,
        }
    }

    /// Find minimum using gradient descent
    /// High complexity function that could be a hotspot
    pub fn gradient_descent<F>(&self, mut x: f64, f: F) -> f64
    where
        F: Fn(f64) -> f64,
    {
        let learning_rate = 0.01;
        let h = 1e-5;

        for _ in 0..self.max_iterations {
            // Compute gradient numerically
            let grad = (f(x + h) - f(x - h)) / (2.0 * h);

            // Update position
            let x_new = x - learning_rate * grad;

            // Check convergence
            if (x_new - x).abs() < self.tolerance {
                break;
            }

            x = x_new;
        }

        x
    }
}

// This function might be dead code if never called
pub fn legacy_computation(input: f64) -> f64 {
    input * 2.0 + 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_engine() {
        let config = ComputeConfig {
            max_workers: 4,
            timeout_seconds: 30,
        };
        let engine = ComputeEngine::new(config);
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = engine.compute_heavy_task(&data);
        assert!(result.success);
    }

    #[test]
    fn test_statistics() {
        let config = ComputeConfig {
            max_workers: 4,
            timeout_seconds: 30,
        };
        let engine = ComputeEngine::new(config);
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let stats = engine.calculate_statistics(&data);
        assert_eq!(stats.mean, 3.0);
    }
}

fn main() {
    let config = ComputeConfig {
        max_workers: 4,
        timeout_seconds: 30,
    };

    let engine = ComputeEngine::new(config);
    let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];

    let result = engine.compute_heavy_task(&data);
    println!("Computation result: {:?}", result);

    let stats = engine.calculate_statistics(&data);
    println!("Statistics: {:?}", stats);
}
