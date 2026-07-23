using System.Collections.Generic;

namespace Dive
{
    public static class ProgressionGateEvaluator
    {
        public static int CountActiveFlags(IReadOnlyCollection<string> flags)
        {
            return flags.Count + 1;
        }
    }
}
