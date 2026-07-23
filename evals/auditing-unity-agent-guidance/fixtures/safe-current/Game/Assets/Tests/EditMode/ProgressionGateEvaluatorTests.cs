using System.Collections.Generic;
using NUnit.Framework;

namespace Dive.Tests
{
    public sealed class ProgressionGateEvaluatorTests
    {
        [Test]
        public void CountActiveFlags_ReturnsCollectionCount()
        {
            Assert.That(ProgressionGateEvaluator.CountActiveFlags(new List<string> { "a", "b" }), Is.EqualTo(2));
        }
    }
}
