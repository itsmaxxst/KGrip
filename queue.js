const { EventEmitter } = require('events');

/**
 * Lightweight Job Queue System
 * Features: Concurrency control, priority queues, retries, delayed jobs
 */
class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency    = options.concurrency || 1;
    this.retryDelay     = options.retryDelay  || 1000;
    this.defaultTimeout = options.timeout     || 30000;
    this.jobs = [];
    this.running = 0;
    this.paused = false;
    this.handlers = new Map();
    
    this.stats = {
      completed: 0,
      failed: 0,
      retried: 0
    };
  }

  /**
   * Register a job handler
   */
  process(jobType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.handlers.set(jobType, handler);
    return this;
  }

  /**
   * Add a job to the queue
   */
  add(jobType, data = {}, options = {}) {
    const job = {
      id: this._generateId(),
      type: jobType,
      data,
      priority:    options.priority || 0,
      attempts: 0,
      maxAttempts: options.maxAttempts || 1,
      timeout:     options.timeout || this.defaultTimeout,
      delay:       options.delay || 0,
      createdAt: Date.now(),
      status: 'pending'
    };

    if (job.delay > 0) {
      job.status = 'delayed';
      setTimeout(() => {
        job.status = 'pending';
        job.delay = 0;
        this._insertJob(job);
        this._process();
      }, job.delay);
    } else {
      this._insertJob(job);
      this._process();
    }

    this.emit('job:added', job);
    return job.id;
  }

  /**
   * Insert job maintaining priority order (higher priority first)
   */
  _insertJob(job) {
    let inserted = false;
    for (let i = 0; i < this.jobs.length; i++) {
      if (job.priority > this.jobs[i].priority) {
        this.jobs.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.jobs.push(job);
    }
  }

  /**
   * Process jobs from the queue
   */
  async _process() {
    if (this.paused || this.running >= this.concurrency) {
      return;
    }

    const job = this.jobs.find(j => j.status === 'pending');
    if (!job) return;

    job.status = 'processing';
    this.running++;
    this.emit('job:start', job);

    try {
      await this._executeJob(job);
    } catch (err) {
      // Error already handled in _executeJob
    } finally {
      this.running--;
      this._process(); // Process next job
    }
  }

  /**
   * Execute a single job with timeout and retry logic
   */
  async _executeJob(job) {
    const handler = this.handlers.get(job.type);
    
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      this.stats.failed++;
      this.emit('job:failed', job, new Error(job.error));
      this._removeJob(job.id);
      return;
    }

    job.attempts++;
    job.startedAt = Date.now();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });

      // Race between job execution and timeout
      const result = await Promise.race([
        handler(job.data, job),
        timeoutPromise
      ]);

      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      this.stats.completed++;
      this.emit('job:completed', job, result);
      this._removeJob(job.id);

    } catch (error) {
      job.error = error.message;
      
      // Retry logic
      if (job.attempts < job.maxAttempts) {
        job.status = 'pending';
        this.stats.retried++;
        this.emit('job:retry', job, error);
        
        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, job.attempts - 1);
        setTimeout(() => this._process(), delay);
        
      } else {
        job.status = 'failed';
        job.failedAt = Date.now();
        this.stats.failed++;
        this.emit('job:failed', job, error);
        this._removeJob(job.id);
      }
    }
  }

  /**
   * Remove job from queue
   */
  _removeJob(jobId) {
    const index = this.jobs.findIndex(j => j.id === jobId);
    if (index !== -1) {
      this.jobs.splice(index, 1);
    }
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.paused = true;
    this.emit('queue:paused');
    return this;
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.paused = false;
    this.emit('queue:resumed');
    this._process();
    return this;
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.find(j => j.id === jobId);
  }

  /**
   * Get all jobs with optional status filter
   */
  getJobs(status) {
    if (status) {
      return this.jobs.filter(j => j.status === status);
    }
    return [...this.jobs];
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      pending: this.jobs.filter(j => j.status === 'pending').length,
      processing: this.running,
      delayed: this.jobs.filter(j => j.status === 'delayed').length,
      total: this.jobs.length
    };
  }

  /**
   * Clear all jobs
   */
  clear() {
    this.jobs = [];
    this.emit('queue:cleared');
    return this;
  }

  /**
   * Generate unique job ID
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Example usage
if (require.main === module) {
  const queue = new JobQueue({ 
    concurrency: 1,
    retryDelay: 0 
  });

  // Listen to events
  queue.on('job:added', (job) => {
    console.log(`a Job added: ${job.id} (${job.type})`);
  });

  queue.on('job:start', (job) => {
    console.log(`p Processing: ${job.id} (attempt ${job.attempts})`);
  });

  queue.on('job:completed', (job, result) => {
    console.log(`c Completed: ${job.id} - Result: ${result}`);
  });

  queue.on('job:failed', (job, error) => {
    console.log(`x Failed: ${job.id} - ${error.message}`);
  });

  queue.on('job:retry', (job) => {
    console.log(`r Retrying: ${job.id} (attempt ${job.attempts})`);
  });

  // Register job handlers
  queue.process('email', async (data) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return `Email sent to ${data.to}`;
  });

  queue.process('report', async (data) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (Math.random() > 0.7) throw new Error('Report generation failed');
    return `Report ${data.name} generated`;
  });

  queue.process('backup', async (data) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return `Backup of ${data.database} completed`;
  });

  // Add jobs with different priorities
  queue.add('email', { to: 'user@example.com' }, { priority: 1 });
  queue.add('report', { name: 'Q4-2024' }, { priority: 1, maxAttempts: 5 });
  queue.add('backup', { database: 'production' }, { priority: 1 });
  queue.add('email', { to: 'admin@example.com' }, { priority: 1 });
  queue.add('report', { name: 'Monthly-Stats' }, { priority: 1 });

  // Display stats after 10 seconds
  setTimeout(() => {
    console.log('\n--- Queue Statistics ---');
    console.log(queue.getStats());
  }, 10000);
}

module.exports = JobQueue;
